import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailLogModule } from '../email-log/email-log.module';

@Module({
  imports: [PrismaModule, EmailLogModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
