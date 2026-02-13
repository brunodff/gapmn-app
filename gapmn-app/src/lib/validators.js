"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFabEmail = isFabEmail;
function isFabEmail(email) {
    var e = email.trim().toLowerCase();
    return e.endsWith("@fab.mil.br");
}
