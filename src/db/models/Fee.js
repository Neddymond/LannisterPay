'use strict';
const mongoose = require('mongoose'),
    Schema = mongoose.Schema;
  

let FeeConfigSpecSchema = new Schema({
  feeId: { type: String, required: true },
  feeCurrency: { type: String, required: true },
  feeLocale: { type: String, required: true },
  feeEntity: { type: String, required: true },
  entityProperty: { type: String, required: true },
  feeType: { type: String, required: true },
  flatFeeValue: { type: Number },
  feeValue: { type: Number },
});

module.exports = mongoose.model('FeeConfiguration', FeeConfigSpecSchema);