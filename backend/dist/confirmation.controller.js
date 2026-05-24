"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var _a, _b, _c, _d;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfirmationController = void 0;
const common_1 = require("@nestjs/common");
const express_1 = require("express");
let ConfirmationController = class ConfirmationController {
    getValue(query, body, key) {
        return query[key] ?? body[key] ?? '';
    }
    hasEsimDetails(query, body = {}) {
        return ['simserial', 'esimQR', 'puk1', 'pin1', 'puk2', 'pin2']
            .some((key) => this.getValue(query, body, key));
    }
    redirectToEsimSuccess(req, res, query, body = {}) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const baseUrl = `${proto}://${host}`;
        const url = new URL('/sim/esim-success', baseUrl);
        const refno = query.refno || body.refno || body.cartid || body.refNo || '';
        const locale = query.locale || body.locale || 'en';
        if (refno)
            url.searchParams.set('refno', String(refno));
        url.searchParams.set('locale', String(locale));
        ['simserial', 'esimQR', 'puk1', 'pin1', 'puk2', 'pin2'].forEach((key) => {
            const value = this.getValue(query, body, key);
            if (value)
                url.searchParams.set(key, String(value));
        });
        return res.redirect(303, url.toString());
    }
    redirectToThankYou(req, res, query, body = {}) {
        const refno = query.refno || body.refno || body.cartid || body.refNo || '';
        const locale = query.locale || body.locale || 'en';
        const status = query.status || body.status || '';
        const description = query.description || body.description || body.desc || '';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const baseUrl = `${proto}://${host}`;
        const url = new URL('/thank-you', baseUrl);
        if (refno)
            url.searchParams.set('refno', String(refno));
        url.searchParams.set('locale', String(locale));
        if (status)
            url.searchParams.set('status', String(status));
        if (description)
            url.searchParams.set('desc', String(description));
        return res.redirect(303, url.toString());
    }
    handleGet(req, res, query) {
        if (this.hasEsimDetails(query)) {
            return this.redirectToEsimSuccess(req, res, query);
        }
        return this.redirectToThankYou(req, res, query);
    }
    handlePost(req, res, query, body) {
        if (this.hasEsimDetails(query, body)) {
            return this.redirectToEsimSuccess(req, res, query, body);
        }
        return this.redirectToThankYou(req, res, query, body);
    }
};
exports.ConfirmationController = ConfirmationController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_a = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _a : Object, typeof (_b = typeof express_1.Response !== "undefined" && express_1.Response) === "function" ? _b : Object, Object]),
    __metadata("design:returntype", void 0)
], ConfirmationController.prototype, "handleGet", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Query)()),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [typeof (_c = typeof express_1.Request !== "undefined" && express_1.Request) === "function" ? _c : Object, typeof (_d = typeof express_1.Response !== "undefined" && express_1.Response) === "function" ? _d : Object, Object, Object]),
    __metadata("design:returntype", void 0)
], ConfirmationController.prototype, "handlePost", null);
exports.ConfirmationController = ConfirmationController = __decorate([
    (0, common_1.Controller)('confirmation')
], ConfirmationController);
//# sourceMappingURL=confirmation.controller.js.map