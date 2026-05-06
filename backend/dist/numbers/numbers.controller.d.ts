import { NumbersService } from './numbers.service';
export declare class NumbersController {
    private readonly numbersService;
    constructor(numbersService: NumbersService);
    search(digits: string): Promise<{
        data: any[];
        message: string;
        total?: undefined;
    } | {
        data: import("./numbers.service").NumberResult[];
        total: number;
        message?: undefined;
    }>;
}
