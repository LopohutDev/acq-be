import { IsEmail, IsNotEmpty } from 'class-validator';

export class UpdatePmoEmailDto {
  @IsEmail()
  @IsNotEmpty()
  pmoEmail: string;
}
