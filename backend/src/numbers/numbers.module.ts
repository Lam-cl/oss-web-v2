import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { NumbersController } from './numbers.controller';
import { NumbersService } from './numbers.service';

@Module({
  imports: [HttpModule],
  controllers: [NumbersController],
  providers: [NumbersService],
})
export class NumbersModule {}
