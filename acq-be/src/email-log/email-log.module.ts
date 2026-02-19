import { Module, Global } from '@nestjs/common';
import { EmailLogService } from './email-log.service';

@Global()
@Module({
  providers: [EmailLogService],
  exports: [EmailLogService],
})
export class EmailLogModule {}
