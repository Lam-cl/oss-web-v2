import { Request, Response } from 'express';
export declare class ConfirmationController {
    private getValue;
    private hasEsimDetails;
    private redirectToEsimSuccess;
    private redirectToThankYou;
    handleGet(req: Request, res: Response, query: any): any;
    handlePost(req: Request, res: Response, query: any, body: any): any;
}
