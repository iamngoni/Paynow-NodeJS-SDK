var RESPONSE_OK = "ok";
var RESPONSE_ERROR = "error";
var URL_INITIATE_TRANSACTION = "https://www.paynow.co.zw/interface/initiatetransaction";
var URL_INITIATE_MOBILE_TRANSACTION = "https://www.paynow.co.zw/interface/remotetransaction";
var http = require("request-promise-native");
var StatusResponse = (function () {
    function StatusResponse(data) {
        if (data.status.toLowerCase() === RESPONSE_ERROR) {
            this.error = data.error;
        }
        else {
            this.reference = data.reference;
            this.amount = data.amount;
            this.paynowreference = data.paynowreference;
            this.pollurl = data.pollurl;
            this.status = data.status;
        }
    }
    return StatusResponse;
}());
var InitResponse = (function () {
    function InitResponse(data) {
        this.status = data.status.toLowerCase();
        this.success = this.status === RESPONSE_OK;
        this.hasRedirect = typeof data.browserurl !== "undefined";
        if (!this.success) {
            this.error = data.error;
        }
        else {
            if (this.hasRedirect) {
                this.redirectUrl = data.browserurl;
                this.pollUrl = data.pollurl;
            }
            if (typeof data.instructions !== "undefined") {
                this.instructions = data.instructions;
            }
        }
    }
    return InitResponse;
}());
var CartItem = (function () {
    function CartItem(title, amount) {
        this.title = title;
        this.amount = amount;
    }
    return CartItem;
}());
var Payment = (function () {
    function Payment(reference, authEmail, items) {
        this.reference = reference;
        this.authEmail = authEmail;
        this.items = items;
    }
    Payment.prototype.add = function (title, amount) {
        this.items.push(new CartItem(title, amount));
        return this;
    };
    Payment.prototype.info = function () {
        var stringOfItemsInCart;
        var infoArr = [];
        this.items.forEach(function (itemInCart) {
            infoArr.push(itemInCart.title);
        });
        stringOfItemsInCart = infoArr.join(",");
        return stringOfItemsInCart;
    };
    Payment.prototype.total = function () {
        return this.items.reduce(function (accumulator, value) {
            return accumulator + Number(value.amount);
        }, 0);
    };
    return Payment;
}());
var Paynow = (function () {
    function Paynow(integrationId, integrationKey, resultUrl, returnUrl) {
        this.integrationId = integrationId;
        this.integrationKey = integrationKey;
        this.resultUrl = resultUrl;
        this.returnUrl = returnUrl;
    }
    Paynow.prototype.send = function (payment) {
        return this.init(payment);
    };
    Paynow.prototype.sendMobile = function (payment, phone, method) {
        return this.initMobile(payment, phone, method);
    };
    Paynow.prototype.createPayment = function (reference, authEmail) {
        return new Payment(reference, authEmail);
    };
    Paynow.prototype.fail = function (message) {
        throw new Error(message);
    };
    Paynow.prototype.init = function (payment) {
        var _this = this;
        this.validate(payment);
        var data = this.build(payment);
        return http({
            method: "POST",
            uri: URL_INITIATE_TRANSACTION,
            form: data,
            json: false
        }, false).then(function (response) {
            return _this.parse(response);
        });
    };
    Paynow.prototype.initMobile = function (payment, phone, method) {
        var _this = this;
        this.validate(payment);
        var data = this.buildMobile(payment, phone, method);
        return http({
            method: "POST",
            uri: URL_INITIATE_MOBILE_TRANSACTION,
            form: data,
            json: false
        }, false).then(function (response) {
            return _this.parse(response);
        });
    };
    Paynow.prototype.parse = function (response) {
        if (typeof response === "undefined") {
            return null;
        }
        if (response) {
            var parsedResponseURL = this.parseQuery(response.url);
            if (response.status.toString() !== "error" &&
                !this.verifyHash(parsedResponseURL)) {
                throw new Error("Hashes do not match!");
            }
            return new InitResponse(parsedResponseURL);
        }
        else {
            throw new Error("An unknown error occurred");
        }
    };
    Paynow.prototype.generateHash = function (values, integrationKey) {
        var sha512 = require("js-sha512").sha512;
        var string = "";
        for (var _i = 0, _a = Object.keys(values); _i < _a.length; _i++) {
            var key = _a[_i];
            if (key !== "hash") {
                string += values[key];
            }
        }
        string += integrationKey.toLowerCase();
        return sha512(string).toUpperCase();
    };
    Paynow.prototype.verifyHash = function (values) {
        if (typeof values["hash"] === "undefined") {
            return false;
        }
        else {
            return values["hash"] === this.generateHash(values, this.integrationKey);
        }
    };
    Paynow.prototype.urlEncode = function (url) {
        return encodeURI(url);
    };
    Paynow.prototype.urlDecode = function (url) {
        return decodeURIComponent((url + "")
            .replace(/%(?![\da-f]{2})/gi, function () {
            return "%25";
        })
            .replace(/\+/g, "%20"));
    };
    Paynow.prototype.parseQuery = function (queryString) {
        var query = {};
        var pairs = (queryString[0] === "?"
            ? queryString.substr(1)
            : queryString).split("&");
        for (var i = 0; i < pairs.length; i++) {
            var pair = pairs[i].split("=");
            query[this.urlDecode(pair[0])] = this.urlDecode(pair[1] || "");
        }
        return query;
    };
    Paynow.prototype.build = function (payment) {
        var data = {
            resulturl: this.resultUrl,
            returnurl: this.returnUrl,
            reference: payment.reference,
            amount: payment.total().toString(),
            id: this.integrationId,
            additionalinfo: payment.info(),
            authemail: typeof payment.authEmail === "undefined" ? "" : payment.authEmail,
            status: "Message"
        };
        for (var _i = 0, _a = Object.keys(data); _i < _a.length; _i++) {
            var key = _a[_i];
            if (key === "hash")
                continue;
            data[key] = this.urlEncode(data[key]);
        }
        data["hash"] = this.generateHash(data, this.integrationKey);
        return data;
    };
    Paynow.prototype.buildMobile = function (payment, phone, method) {
        if (payment.authEmail.length <= 0) {
            throw new Error("Auth email is required for mobile transactions. You can pass it as the second parameter to the createPayment method call");
        }
        var data = {
            resulturl: this.resultUrl,
            returnurl: this.returnUrl,
            reference: payment.reference,
            amount: payment.total().toString(),
            id: this.integrationId,
            additionalinfo: payment.info(),
            authemail: payment.authEmail,
            phone: phone,
            method: method,
            status: "Message"
        };
        for (var _i = 0, _a = Object.keys(data); _i < _a.length; _i++) {
            var key = _a[_i];
            if (key === "hash")
                continue;
            data[key] = this.urlEncode(data[key]);
        }
        data["hash"] = this.generateHash(data, this.integrationKey);
        return data;
    };
    Paynow.prototype.pollTransaction = function (url) {
        var _this = this;
        return http({
            method: "POST",
            uri: url,
            json: false
        }, false).then(function (response) {
            return _this.parseStatusUpdate(response);
        });
    };
    Paynow.prototype.parseStatusUpdate = function (response) {
        if (response.length > 0) {
            response = this.parseQuery(response);
            if (!this.verifyHash(response)) {
                throw new Error("Hashes do not match!");
            }
            return new StatusResponse(response);
        }
        else {
            throw new Error("An unknown error occurred");
        }
    };
    Paynow.prototype.validate = function (payment) {
        if (payment.items.length <= 0) {
            this.fail("You need to have at least one item in cart");
        }
        if (payment.total() <= 0) {
            this.fail("The total should be greater than zero");
        }
    };
    return Paynow;
}());
;
module.exports = Paynow;
//# sourceMappingURL=index.js.map