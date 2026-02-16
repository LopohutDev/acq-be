import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { type Response } from 'express';
import { GmailService } from './gmail.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdatePmoEmailDto } from './dto/update-pmo-email.dto';
import { SendPmoEmailDto } from './dto/send-pmo-email.dto';

@Controller('gmail')
export class GmailController {
  constructor(private readonly gmailService: GmailService) {}

  @Get('connect')
  @UseGuards(JwtAuthGuard)
  connect(@Request() req) {
    return { authUrl: this.gmailService.generateAuthUrl(req.user.id) };
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') userId: string, @Res() res: Response) {
    try {
      await this.gmailService.handleCallback(code, userId);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
      return res.redirect(`${frontendUrl}/user/profile?gmail=connected`);
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
      return res.redirect(`${frontendUrl}/user/profile?gmail=error&message=${encodeURIComponent(error.message)}`);
    }
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  getStatus(@Request() req) {
    return this.gmailService.getConnectionStatus(req.user.id);
  }

  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  disconnect(@Request() req) {
    return this.gmailService.disconnect(req.user.id);
  }

  @Patch('pmo-email')
  @UseGuards(JwtAuthGuard)
  updatePmoEmail(@Request() req, @Body() dto: UpdatePmoEmailDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('PMO email configuration is not available in production');
    }
    return this.gmailService.updatePmoRecipientEmail(req.user.id, dto.pmoEmail);
  }

  @Post('send-pmo')
  @UseGuards(JwtAuthGuard)
  sendPmoEmail(@Request() req, @Body() dto: SendPmoEmailDto) {
    return this.gmailService.sendPmoEmail(req.user.id, dto.subject, dto.body);
  }

  @Post('send-pmo-template/:type')
  @UseGuards(JwtAuthGuard)
  sendPmoTemplate(
    @Request() req,
    @Param('type') type: 'BOOKING_CONFIRMATION' | 'PMO_REQUEST' | 'CUSTOM',
    @Body() variables?: Record<string, string>,
  ) {
    return this.gmailService.sendPmoEmailTemplate(req.user.id, type, variables);
  }
}
