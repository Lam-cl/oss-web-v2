import { IsString, IsNotEmpty } from 'class-validator';

export class SearchNumberDto {
  @IsString()
  @IsNotEmpty()
  digits: string;
}
