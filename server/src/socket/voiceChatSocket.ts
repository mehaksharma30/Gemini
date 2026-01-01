import { Server, Socket } from 'socket.io';
import { getSpeechConfig, createPushAudioInputStream, isAzureSpeechAvailable } from '../services/azureSpeech.service';
import { getAIPanicResponse } from '../services/aiPanic.service';
import Post from '../models/Post';
import mongoose from 'mongoose';

// Azure Speech SDK - optional import
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
let sdk: typeof SpeechSDK | null = null;
try {
  sdk = SpeechSDK;
} catch (error) {
  // SDK not installed - voice features will be disabled
}

interface VoiceChatSession {
  userId: string;
  recognizer: SpeechSDK.SpeechRecognizer | null;
  audioInputStream: SpeechSDK.PushAudioInputStream | null;
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
        if (!sdk || !isAzureSpeechAvailable()) {
          socket.emit('voice:error', { message: 'Azure Speech not available. Please install: npm install microsoft-cognitiveservices-speech-sdk' });
          return;
        }

        const { userId } = data;
        const speechConfig = getSpeechConfig();

        if (!speechConfig) {
          socket.emit('voice:error', { message: 'Azure Speech not configured' });
          return;
        }

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

        if (!sdk) {
          socket.emit('voice:error', { message: 'Azure Speech SDK not available' });
          return;
        }

        // Create audio input stream for STT
        // Format: 16kHz, 16-bit, mono PCM (matches frontend)
        const audioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
        const audioInputStream = sdk.AudioInputStream.createPushStream(audioFormat);
        const audioConfig = sdk.AudioConfig.fromStreamInput(audioInputStream);
        
        console.log('[Voice Chat] Audio stream created, format: 16kHz, 16-bit, mono PCM');

        // Create speech recognizer
        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

        // Store session
        const session: VoiceChatSession = {
          userId,
          recognizer,
          audioInputStream,
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

            // Convert AI response to speech using Azure TTS
            try {
              const { textToSpeech } = require('../services/azureSpeech.service');
              const audioData = await textToSpeech(aiResponse);
              
              // Convert ArrayBuffer to Buffer and send as base64
              const audioBuffer = Buffer.from(audioData);
              const base64Audio = audioBuffer.toString('base64');
              
              // Send complete audio (WAV format from Azure)
              socket.emit('voice:audio-chunk', {
                audio: base64Audio,
                isFinal: true, // Complete audio
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
        recognizer.recognizing = (s: SpeechSDK.Recognizer, e: SpeechSDK.SpeechRecognitionEventArgs) => {
          if (e.result && e.result.text) {
            currentInterimText = e.result.text;
            console.log('[Voice Chat] Interim text:', e.result.text);
            socket.emit('voice:interim', { text: e.result.text });
            
            // Reset silence timer - user is still speaking
            if (silenceTimer) {
              clearTimeout(silenceTimer);
              silenceTimer = null;
            }
          }
        };

        // Handle speech end detection (user stopped speaking)
        recognizer.speechEndDetected = (s: SpeechSDK.Recognizer, e: SpeechSDK.RecognitionEventArgs) => {
          console.log('[Voice Chat] Speech end detected');
          // Start silence timer - if no more speech in 1.5s, auto-send
          if (silenceTimer) {
            clearTimeout(silenceTimer);
          }
          silenceTimer = setTimeout(async () => {
            if (currentInterimText.trim()) {
              await processFinalText(currentInterimText.trim());
              currentInterimText = '';
            }
          }, SILENCE_TIMEOUT);
        };

        // Handle final recognition results
        recognizer.recognized = (s: SpeechSDK.Recognizer, e: SpeechSDK.SpeechRecognitionEventArgs) => {
          if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text) {
            const userText = e.result.text.trim();
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
          }
        };

        recognizer.canceled = (s: SpeechSDK.Recognizer, e: SpeechSDK.SpeechRecognitionCanceledEventArgs) => {
          console.log('[Voice Chat] Recognition canceled:', e.errorDetails);
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
          socket.emit('voice:error', { message: e.errorDetails });
        };

        recognizer.sessionStopped = (s: SpeechSDK.Recognizer, e: SpeechSDK.SessionEventArgs) => {
          console.log('[Voice Chat] Session stopped');
          if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
          }
        };

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
      if (session && session.audioInputStream) {
        try {
          const audioBuffer = Buffer.from(data.audio, 'base64');
          // Convert Buffer to ArrayBuffer for Azure SDK
          const arrayBuffer = new ArrayBuffer(audioBuffer.length);
          const view = new Uint8Array(arrayBuffer);
          view.set(audioBuffer);
          session.audioInputStream.write(arrayBuffer);
          audioChunkCount++;
          
          // Log first few chunks and then occasionally
          if (audioChunkCount <= 3 || audioChunkCount % 50 === 0) {
            console.log('[Voice Chat] Received audio chunk #' + audioChunkCount + ', size:', audioBuffer.length, 'bytes');
          }
        } catch (error) {
          console.error('[Voice Chat] Error processing audio:', error);
        }
      } else {
        console.warn('[Voice Chat] No session or audioInputStream for socket:', socket.id);
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
        if (session.audioInputStream) {
          session.audioInputStream.close();
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
        if (session.audioInputStream) {
          session.audioInputStream.close();
        }
        activeSessions.delete(socket.id);
      }
      console.log('[Voice Chat] Client disconnected:', socket.id);
    });
  });
}


