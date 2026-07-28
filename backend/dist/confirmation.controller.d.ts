import { Request, Response } from 'express';
export declare class ConfirmationController {
    private getValue;
    private hasEsimDetails;
    private isAdx;
    private isEsim;
    private redirectToEsimSuccess;
    private redirectToThankYou;
    handleGet(req: Request, res: Response, query: any): any;
    handleEsimGet(req: Request, res: Response, query: any): any;
    handlePost(req: Request, res: Response, query: any, body: any): any;
    handleEsimPost(req: Request, res: Response, query: any, body: any): any;
}
