import { PlansService } from './plans.service';
export declare class PlansController {
    private readonly plansService;
    constructor(plansService: PlansService);
    findAll(): Promise<import("./plan.entity").Plan[]>;
    findOne(slug: string): Promise<import("./plan.entity").Plan>;
}
