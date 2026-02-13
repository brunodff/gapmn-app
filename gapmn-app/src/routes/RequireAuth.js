"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RequireAuth;
var react_1 = require("react");
var react_router_dom_1 = require("react-router-dom");
var supabase_1 = require("../lib/supabase");
function RequireAuth(_a) {
    var children = _a.children;
    var _b = (0, react_1.useState)(true), loading = _b[0], setLoading = _b[1];
    var _c = (0, react_1.useState)(false), hasSession = _c[0], setHasSession = _c[1];
    var loc = (0, react_router_dom_1.useLocation)();
    (0, react_1.useEffect)(function () {
        var isMounted = true;
        supabase_1.supabase.auth.getSession().then(function (_a) {
            var data = _a.data;
            if (!isMounted)
                return;
            setHasSession(!!data.session);
            setLoading(false);
        });
        var authListener = supabase_1.supabase.auth.onAuthStateChange(function (_event, session) {
            setHasSession(!!session);
        }).data;
        return function () {
            var _a;
            isMounted = false;
            (_a = authListener === null || authListener === void 0 ? void 0 : authListener.subscription) === null || _a === void 0 ? void 0 : _a.unsubscribe();
        };
    }, []);
    if (loading)
        return <div style={{ padding: 24 }}>Carregando...</div>;
    if (!hasSession)
        return <react_router_dom_1.Navigate to="/login" replace state={{ from: loc.pathname }}/>;
    return <>{children}</>;
}
