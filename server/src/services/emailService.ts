import nodemailer from 'nodemailer';

export interface SendEmergencyEmailParams {
  toEmail: string;
  senderUsername: string;
  senderUserId: string;
  incidentId: string;
}

export async function sendEmergencyEmail({
  toEmail,
  senderUsername,
  senderUserId,
  incidentId,
}: SendEmergencyEmailParams): Promise<{ success: boolean; previewUrl?: string; error?: string }> {
  try {
    const emailProvider = process.env.EMAIL_PROVIDER || 'ethereal';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';

    let transporter: nodemailer.Transporter;
    let testAccount: nodemailer.TestAccount | null = null;

    // Use Gmail SMTP if EMAIL_PROVIDER is set to "gmail"
    if (emailProvider === 'gmail') {
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error('Gmail credentials not configured. EMAIL_USER and EMAIL_PASS must be set in .env');
        return {
          success: false,
          error: 'Email service not configured',
        };
      }

      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    } else {
      // Fallback to Ethereal for testing
      testAccount = await nodemailer.createTestAccount();

      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }

    // Email content
    const subject = `MindMemos Emergency Alert: ${senderUsername} needs support`;
    const body = `${senderUsername} triggered an emergency support request on MindMemos.
Please open the app to respond: ${frontendUrl}/alerts (or /messages)
Incident: ${incidentId}`;

    // Determine "from" field
    const fromField = emailProvider === 'gmail' 
      ? (process.env.EMAIL_FROM || `"MindMemos Alerts" <${process.env.EMAIL_USER}>`)
      : `"MindMemos" <${testAccount?.user || 'noreply@mindmemos.com'}>`;

    // Send email
    const info = await transporter.sendMail({
      from: fromField,
      to: toEmail,
      subject,
      text: body,
    });

    // Only log preview URL for Ethereal (test mode)
    if (emailProvider !== 'gmail') {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log('📧 Email sent! Preview URL:', previewUrl);
      }
      return {
        success: true,
        previewUrl: previewUrl || undefined,
      };
    } else {
      console.log(`📧 Emergency email sent to ${toEmail} via Gmail SMTP`);
      return {
        success: true,
      };
    }
  } catch (error: any) {
    console.error('Email sending error:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email',
    };
  }
}

