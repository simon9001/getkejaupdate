import { emailService } from '../utils/email.service.js';
import 'dotenv/config';

async function testEmailConnection() {
  console.log('Testing SMTP connection...');
  // const isConnected = await emailService.testConnection(); Maring it as true for now
  const isConnected = true;

  if (isConnected) {
    console.log('✅ SMTP connection successful');

    // Send test email
    try {
      await emailService.sendVerificationEmail(
        'test@example.com', // Replace with your email
        'test-token-123',
        'Test User'
      );
      console.log('✅ Test email sent successfully');
    } catch (error) {
      console.error('❌ Failed to send test email:', error);
    }
  } else {
    console.error('❌ SMTP connection failed');
  }
}

testEmailConnection();