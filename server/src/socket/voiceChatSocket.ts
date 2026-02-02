import { Server, Socket } from 'socket.io';
import { createStreamingRecognizer, GoogleStreamingRecognizer } from '../services/googleSpeech.service';
import { getAIPanicResponse } from '../services/aiPanic.service';
import Post from '../models/Post';
import mongoose from 'mongoose';

interface VoiceChatSession {
  userId: string;
  recognizer: GoogleStreamingRecognizer | null;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  userPosts: Array<{ title: string; content: string; tags: string[]; createdAt: Date }>;
}

const activeSessions = new Map<string, VoiceChatSession>();

/**
 * Setup real-time voice chat socket handlers
 */
export function setupVoiceChatSocket(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log('[Voice Chat] Client connected:', socket.id);

    // Initialize voice chat session
    socket.on('voice:start', async (data: { userId: string }) => {
      try {
        // Check for Google Cloud credentials
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          socket.emit('voice:error', { message: 'Google Cloud Speech not configured. Please set GOOGLE_APPLICATION_CREDENTIALS environment variable.' });
          return;
        }

        const { userId } = data;

        // Fetch user's recent posts for context
        let userPosts: Array<{ title: string; content: string; tags: string[]; createdAt: Date }> = [];
        try {
          const posts = await Post.find({ 
            authorId: new mongoose.Types.ObjectId(userId) 
          })
            .sort({ createdAt: -1 })
            .limit(10)
            .select('title content tags createdAt')
            .lean();
          
          userPosts = posts.map(post => ({
            title: post.title,
            content: post.content,
            tags: post.tags || [],
            createdAt: post.createdAt,
          }));
        } catch (err) {
          console.error('[Voice Chat] Error fetching user posts:', err);
        }

        // Create Google Speech streaming recognizer
        const languageCode = process.env.GOOGLE_SPEECH_LANGUAGE || 'en-US';
        const recognizer = createStreamingRecognizer(languageCode);
        
        console.log('[Voice Chat] Google Speech recognizer created, format: 16kHz, 16-bit, mono PCM, language:', languageCode);

        // Store session
        const session: VoiceChatSession = {
          userId,
          recognizer,
          conversationHistory: [],
          userPosts,
        };
        activeSessions.set(socket.id, session);

        // Track current interim text for auto-send
        let currentInterimText = '';
        let silenceTimer: NodeJS.Timeout | null = null;
        const SILENCE_TIMEOUT = 1500; // 1.5 seconds of silence = user stopped speaking

        // Helper function to process final text and get AI response
        const processFinalText = async (userText: string): Promise<void> => {
          console.log('[Voice Chat] User said:', userText);
          socket.emit('voice:user-text', { text: userText });

          // Add to conversation history
          session.conversationHistory.push({ role: 'user', content: userText });

          // Get AI response
          try {
            const aiResponse = await getAIPanicResponse(
              userText,
              session.conversationHistory.slice(0, -1),
              { recentPosts: session.userPosts }
            );

            // Add AI response to history
            session.conversationHistory.push({ role: 'assistant', content: aiResponse });
            socket.emit('voice:ai-text', { text: aiResponse });

            // Convert AI response to speech using Google TTS
            try {
              const { synthesizeToMp3 } = require('../services/googleTts.service');
              const audioBuffer = await synthesizeToMp3(aiResponse);
              const base64Audio = audioBuffer.toString('base64');
              socket.emit('voice:audio-chunk', {
                audio: base64Audio,
                isFinal: true,
              });
              console.log('[Voice Chat] TTS audio sent, size:', audioBuffer.length, 'bytes');
            } catch (ttsError: any) {
              console.error('[Voice Chat] TTS error:', ttsError);
              socket.emit('voice:error', { message: 'Failed to generate speech: ' + ttsError.message });
            }

          } catch (error: any) {
            console.error('[Voice Chat] AI error:', error);
            socket.emit('voice:error', { message: error.message || 'Failed to get AI response' });
          }
        };

        // Handle interim recognition results (real-time transcription)
        recognizer.setRecognizing((text: string) => {
          currentInterimText = text;
          console.log('[Voice Chat] Interim text:', text);
          socket.emit('voice:interim', { text });
          
          // Reset silence timer - user is still speaking
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        });

        // Handle final recognition results
        recognizer.setRecognized((text: string) => {
          const userText = text.trim();
          if (!userText) return;

          // Clear silence timer since we got final result
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
          currentInterimText = '';

          processFinalText(userText).catch((err) => {
            console.error('[Voice Chat] Error processing final text:', err);
          });
        });

        // Handle errors
        recognizer.setCanceled((error: Error) => {
          console.log('[Voice Chat] Recognition canceled:', error.message);
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
          socket.emit('voice:error', { message: error.message });
        });

        // Start continuous recognition
        recognizer.startContinuousRecognitionAsync(
          () => {
            console.log('[Voice Chat] Continuous recognition started for:', socket.id);
            socket.emit('voice:ready', { message: 'Voice chat ready' });
          },
          (error: string) => {
            console.error('[Voice Chat] Failed to start recognition:', error);
            socket.emit('voice:error', { message: 'Failed to start voice recognition' });
          }
        );

      } catch (error: any) {
        console.error('[Voice Chat] Start error:', error);
        socket.emit('voice:error', { message: error.message || 'Failed to start voice chat' });
      }
    });

    // Handle incoming audio data
    let audioChunkCount = 0;
    socket.on('voice:audio', (data: { audio: string }) => {
      const session = activeSessions.get(socket.id);
      if (session && session.recognizer) {
        try {
          const audioBuffer = Buffer.from(data.audio, 'base64');
          // Write audio chunk to Google Speech stream
          session.recognizer.write(audioBuffer);
          audioChunkCount++;
          
          // Log first few chunks and then occasionally
          if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
            console.log('[Voice Chat] Received audio chunk #' + audioChunkCount + ', size:', audioBuffer.length, 'bytes');
          }
        } catch (error) {
          console.error('[Voice Chat] Error processing audio:', error);
        }
      } else {
        console.warn('[Voice Chat] No session or recognizer for socket:', socket.id);
      }
    });

    // Stop voice chat
    socket.on('voice:stop', () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        if (session.recognizer) {
          session.recognizer.stopContinuousRecognitionAsync(
            () => {
              session.recognizer?.close();
            },
            (error: string) => {
              console.error('[Voice Chat] Error stopping recognition:', error);
            }
          );
        }
        activeSessions.delete(socket.id);
        console.log('[Voice Chat] Session ended for:', socket.id);
      }
      socket.emit('voice:stopped');
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        if (session.recognizer) {
          session.recognizer.stopContinuousRecognitionAsync(
            () => {
              session.recognizer?.close();
            },
            () => {}
          );
        }
        activeSessions.delete(socket.id);
      }
      console.log('[Voice Chat] Client disconnected:', socket.id);
    });
  });
}


