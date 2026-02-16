import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service';

const OAuth2 = google.auth.OAuth2;

interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(private prisma: PrismaService) {}

  private getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new BadRequestException('Google OAuth credentials not configured');
    }

    return new OAuth2(clientId, clientSecret, redirectUri);
  }

  generateAuthUrl(userId: string): string {
    const oauth2Client = this.getOAuth2Client();
    
    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: userId,
    });
  }

  async handleCallback(code: string, userId: string) {
    const oauth2Client = this.getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token) {
      throw new BadRequestException('Failed to obtain access token from Google');
    }

    oauth2Client.setCredentials(tokens);

    // Get user email from OAuth2 userinfo endpoint
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();
    const email = userinfo.data.email;

    if (!email) {
      throw new BadRequestException('Failed to get email from Google profile');
    }

    const existingAccount = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    const refreshToken = tokens.refresh_token || existingAccount?.refreshToken;

    if (existingAccount) {
      return this.prisma.clientEmailAccount.update({
        where: { clientId: userId },
        data: {
          email,
          accessToken: tokens.access_token,
          refreshToken: refreshToken,
          provider: 'gmail',
          isActive: true,
        },
      });
    }

    if (!refreshToken) {
      throw new BadRequestException('Failed to obtain refresh token. Please revoke access and try again.');
    }

    return this.prisma.clientEmailAccount.create({
      data: {
        email,
        accessToken: tokens.access_token,
        refreshToken: refreshToken,
        provider: 'gmail',
        isActive: true,
        clientId: userId,
      },
    });
  }

  async disconnect(userId: string) {
    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    if (!account) {
      throw new NotFoundException('Gmail account not connected');
    }

    if (account.accessToken) {
      try {
        const oauth2Client = this.getOAuth2Client();
        oauth2Client.setCredentials({ access_token: account.accessToken });
        await oauth2Client.revokeCredentials();
      } catch (error) {
        this.logger.warn('Failed to revoke Google credentials:', error.message);
      }
    }

    await this.prisma.clientEmailAccount.delete({
      where: { clientId: userId },
    });

    return { success: true, message: 'Gmail account disconnected' };
  }

  async getConnectionStatus(userId: string) {
    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
      select: {
        email: true,
        isActive: true,
        pmolRecipientEmail: true,
        createdAt: true,
      },
    });

    if (!account) {
      return { connected: false };
    }

    return {
      connected: true,
      email: account.email,
      isActive: account.isActive,
      pmoRecipientEmail: account.pmolRecipientEmail,
      connectedAt: account.createdAt,
    };
  }

  async updatePmoRecipientEmail(userId: string, pmoEmail: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('PMO email configuration is not available in production');
    }

    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    if (!account) {
      throw new NotFoundException('Gmail account not connected');
    }

    return this.prisma.clientEmailAccount.update({
      where: { clientId: userId },
      data: { pmolRecipientEmail: pmoEmail },
    });
  }

  async sendPmoEmail(
    userId: string,
    subject: string,
    body: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const account = await this.prisma.clientEmailAccount.findUnique({
      where: { clientId: userId },
    });

    if (!account) {
      throw new NotFoundException('Gmail account not connected');
    }

    if (!account.accessToken || !account.refreshToken) {
      throw new BadRequestException('Gmail tokens not available');
    }

    // In production, use hardcoded PMO emails
    const isDev = process.env.NODE_ENV !== 'production';
    const recipients = isDev && account.pmolRecipientEmail
      ? [account.pmolRecipientEmail]
      : [
          'ACQUA PMO <pmo@acqua-residences.com>',
          'ACQUA Concierge Executive <concierge@acqua-residences.com>',
        ];

    const oauth2Client = this.getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    try {
      const results: string[] = [];
      for (const recipient of recipients) {
        const rawEmail = this.createRawEmail(
          account.email,
          recipient,
          subject,
          body,
        );

        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: rawEmail,
          },
        });

        if (response.data.id) {
          results.push(response.data.id);
        }
        this.logger.log(`PMO email sent from ${account.email} to ${recipient}`);
      }

      return {
        success: true,
        messageId: results[0],
      };
    } catch (error) {
      this.logger.error(`Failed to send PMO email: ${error.message}`);
      
      if (error.code === 401 || error.message?.includes('invalid')) {
        throw new BadRequestException('Gmail authorization expired. Please reconnect your account.');
      }
      
      throw new BadRequestException(`Failed to send email: ${error.message}`);
    }
  }

  private createRawEmail(
    from: string,
    to: string,
    subject: string,
    body: string,
  ): string {
    const message = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ].join('\r\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async sendPmoEmailTemplate(
    userId: string,
    templateType: 'BOOKING_CONFIRMATION' | 'PMO_REQUEST' | 'CUSTOM',
    variables?: Record<string, string>,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const { subject, body } = this.getTemplate(templateType, variables);
    return this.sendPmoEmail(userId, subject, body);
  }

  private getTemplate(
    type: 'BOOKING_CONFIRMATION' | 'PMO_REQUEST' | 'CUSTOM',
    variables?: Record<string, string>,
  ): { subject: string; body: string } {
    const bookingDate = variables?.bookingDate || '[Date]';
    const slotNumber = variables?.slotNumber || '[Slot Number]';
    const tower = variables?.tower || '[Tower]';
    const startTime = variables?.startTime || '[Start Time]';
    const endTime = variables?.endTime || '[End Time]';

    const templates = {
      BOOKING_CONFIRMATION: {
        subject: `Parking Slot Booking Confirmation - ${tower} - ${slotNumber}`,
        body: `
          <h2>Parking Booking Confirmation</h2>
          <p>Dear Property Management Office,</p>
          <p>This is to confirm that parking slot <strong>${slotNumber}</strong> at <strong>${tower}</strong> has been booked.</p>
          <p><strong>Details:</strong></p>
          <ul>
            <li>Date: ${bookingDate}</li>
            <li>Time: ${startTime} - ${endTime}</li>
            <li>Location: ${tower} - ${slotNumber}</li>
          </ul>
          <p>Please acknowledge this booking.</p>
          <p>Thank you.</p>
        `,
      },
      PMO_REQUEST: {
        subject: `PMO Request for Parking Slot ${tower} - ${slotNumber}`,
        body: `
          <h2>PMO Request</h2>
          <p>Dear Property Management Office,</p>
          <p>I would like to request approval for the use of parking slot <strong>${slotNumber}</strong> at <strong>${tower}</strong>.</p>
          <p><strong>Requested Schedule:</strong></p>
          <ul>
            <li>Date: ${bookingDate}</li>
            <li>Time: ${startTime} - ${endTime}</li>
          </ul>
          <p>Please let me know if this requires any additional approval or documentation.</p>
          <p>Thank you.</p>
        `,
      },
      CUSTOM: {
        subject: variables?.subject || 'PMO Communication',
        body: variables?.body || '<p>No content provided.</p>',
      },
    };

    return templates[type];
  }
}
