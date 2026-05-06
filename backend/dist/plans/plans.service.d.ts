import { Repository } from 'typeorm';
import { Plan } from './plan.entity';
export declare class PlansService {
    private planRepo;
    constructor(planRepo: Repository<Plan>);
    findAll(): Promise<Plan[]>;
    findBySlug(slug: string): Promise<Plan>;
}
