import { IsNotEmpty, IsString } from 'class-validator';

export class SendPmoEmailDto {
  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  body: string;
}
