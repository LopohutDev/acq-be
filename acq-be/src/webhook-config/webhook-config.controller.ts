import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PaymentService } from '../payment/payment.service';

@Controller('webhook-config')
export class WebhookConfigController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('setup')
  @HttpCode(HttpStatus.OK)
  getWebhookSetup() {
    const webhookUrl = `${process.env.FRONTEND_URL || 'http://localhost:8081'}/api/webhooks/experia`;
    const apiKey = process.env.EXPERIA_PG_API_KEY;
    const webhookSecret = process.env.EXPERIA_PG_WEBHOOK_SECRET;
    
    return {
      success: true,
      webhookUrl,
      webhookUrlWithNgrok: `https://<your-ngrok-subdomain>.ngrok.io${webhookUrl}`,
      instructions: [
        '1. Copy this webhook URL',
        '2. Go to your Experia PG dashboard',
        '3. Navigate to webhook configuration',
        '4. Paste the webhook URL in the webhook URL field',
        '5. Set webhook secret (optional)',
        '6. Save and test the webhook',
        '7. Your webhooks will fire when payments complete'
      ],
      apiKeySet: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'not set',
      webhookSecretSet: !!webhookSecret,
      webhookSecretConfigured: webhookSecret ? webhookSecret.substring(0, 10) + '...' : 'not set',
      currentEnvironment: process.env.NODE_ENV || 'development',
      environment: {
        development: {
          frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8081',
          webhookUrl: `http://localhost:3000${webhookUrl}`,
          ngrokCommand: 'ngrok http 3000',
          instructions: [
            'Start ngrok: `ngrok http 3000`',
            'Copy the ngrok URL',
            'Use the ngrok URL as your webhook URL in Experia PG dashboard'
          ]
        },
        production: {
          frontendUrl: process.env.FRONTEND_URL,
          webhookUrl: `https://yourdomain.com${webhookUrl}`,
          instructions: [
            'Ensure your domain has SSL certificate',
            'Set this URL in Experia PG webhook configuration',
            'Test with a real payment to verify webhook is working'
          ]
        }
      }
    };
  }

  @Get('test-experia-pg')
  async testExperiaPG() {
    try {
      const testResponse = await this.paymentService.testConnection();
      return testResponse;
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}