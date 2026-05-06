import { Controller, Get, Query } from '@nestjs/common';
import { NumbersService } from './numbers.service';

@Controller('numbers')
export class NumbersController {
  constructor(private readonly numbersService: NumbersService) {}

  @Get('search')
  async search(@Query('digits') digits: string) {
    if (!digits || digits.length < 1) {
      return { data: [], message: 'Please provide digits to search' };
    }
    const results = await this.numbersService.searchSpecialNumbers(digits);
    return { data: results, total: results.length };
  }
}
