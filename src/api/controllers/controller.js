const mongoose = require('mongoose');
const R = require('ramda');
const { handleError } = require('../../utility/error');
const FeeConfigurationSpec = mongoose.model('FeeConfiguration');
const { redisClient } = require('../../db/models/redis');

exports.parseFeeConfigSpec = async (req, res) => {
  try {
    if(req.body.constructor === Object && Object.keys(req.body).length === 0) {
      return handleError('Kindly provide a fee configuration specification', res, 400);
    }

    const feeConfigurationSpec = req.body.FeeConfigurationSpec;
    let parsedFeeConfigurationSpec;

    const allConfig = [];

    if (feeConfigurationSpec.match('\n')) {

      parsedFeeConfigurationSpec = feeConfigurationSpec.split('\n');

      for (let i = 0; i < parsedFeeConfigurationSpec.length; i++) {
        const splitConfigSpec = parsedFeeConfigurationSpec[i].split(' ');
        if (splitConfigSpec.length !== 8) {
          return handleError('Invalid fee configuration spec', res, 400);
        }
        const entity = splitConfigSpec[3].split(/[()]/);
        entity.pop();
        if (entity.length !== 2) {
          return handleError('Invalid fee configuration spec', res, 400);
        }

        allConfig.push({
          feeId: splitConfigSpec[0],
          feeCurrency: splitConfigSpec[1],
          feeLocale: splitConfigSpec[2],
          feeEntity: entity[0],
          entityProperty: entity[1],
          feeType: splitConfigSpec[6],
          flatFeeValue: splitConfigSpec[6] === 'FLAT' ? Number(splitConfigSpec[7]) : splitConfigSpec[7].match(':') ? Number(splitConfigSpec[7].split(':')[0]) : null,
          feeValue: splitConfigSpec[6] === 'PERC' ? Number(splitConfigSpec[7]) : splitConfigSpec[7].match(':') ? Number(splitConfigSpec[7].split(':')[1]) : null,
        });
      }
    }

    await hashConfigSpec(allConfig);
    
    const newFeeConfigurationSpec = await FeeConfigurationSpec.insertMany(allConfig);
    if (!newFeeConfigurationSpec) {
      handleError('Couldn\'t create fee config spec', res, 400);
    }

    return res.status(200).send({ status: 'ok' });
  } catch (error) {
    handleError(error.message, res, 500);
  }
}

exports.computeTransactionFee = async (req, res) => {
  try {
    const transactionFeePayload = req.body;
    let feeConfigSpec = [];

    if ((await redisClient.scan(0)).keys && (await redisClient.scan(0)).keys.length > 0) {
     
      for (const key of (await redisClient.scan(0)).keys) {
        feeConfigSpec.push(JSON.parse(JSON.stringify(await redisClient.hGetAll(key))));
      }
    } else {
      feeConfigSpec = await FeeConfigurationSpec.find({}).lean();
      if (!feeConfigSpec) {
        return handleError('Config spec not found to compute this transaction', res, 404);
      }
      await hashConfigSpec(feeConfigSpec);
    }
    const mostSuitableCofigSpec =  findMostSuitableFeeConfigSpec(feeConfigSpec, transactionFeePayload);
    if (!mostSuitableCofigSpec || mostSuitableCofigSpec.length === 0) {
      return handleError('No fee configuration is applicable to this transaction', res, 400);
    }

    const appliedFeeValue = calcAppliedFeeValue(mostSuitableCofigSpec, transactionFeePayload);
    if (!appliedFeeValue) {
      return handleError('Can\'t compute applied fee value', res, 400);
    }

    const chargeAmount = calcChargeAmount(appliedFeeValue, transactionFeePayload);

    const settleAmount = chargeAmount - appliedFeeValue;

    return res.status(200).send({
      'AppliedFeeID': mostSuitableCofigSpec.feeId,
      'AppliedFeeValue': appliedFeeValue,
      'ChargeAmount': chargeAmount,
      'SettlementAmount': settleAmount
    });

  } catch (error) {
    handleError(error.message, res, 500);
  }
}

const findMostSuitableFeeConfigSpec = (feeConfigSpec, transactionPayload) => {
  const payloadLocale = transactionPayload.PaymentEntity.Country === transactionPayload.CurrencyCountry ? 'LOCL' : 'INTL';
  let mostSuitableConfig = [];

  // currency check
  mostSuitableConfig = feeConfigSpec.filter(cfg => cfg.feeCurrency === transactionPayload.Currency);

  if (mostSuitableConfig.length === 0) {
    return mostSuitableConfig;
  }

  // feeEntity
  const feeEntityExactMatchConfig = R.reject(
    R.allPass([
      R.complement(R.propEq('feeEntity', transactionPayload.PaymentEntity.Type)),
      R.complement(R.propEq('feeEntity', '*'))
    ])
  )(mostSuitableConfig);
  if (feeEntityExactMatchConfig.length > 0) mostSuitableConfig = feeEntityExactMatchConfig;

  if (mostSuitableConfig.length === 0) {
    return mostSuitableConfig;
  }

  // feeLocal check
  const feeLocaleExactMatchConfig = R.reject(
    R.allPass([
      R.complement(R.propEq('feeLocale', payloadLocale)),
      R.complement(R.propEq('feeLocale', '*'))
    ])
  )(mostSuitableConfig);

  if (feeLocaleExactMatchConfig.length > 0) mostSuitableConfig = feeLocaleExactMatchConfig;

  if (mostSuitableConfig.length === 0) {
    return mostSuitableConfig;
  }

  // entity property
  const feeEntityPropertyExactMatchConfig = mostSuitableConfig.filter(cfg => {
    return [transactionPayload.PaymentEntity.Brand, transactionPayload.PaymentEntity.ID, transactionPayload.PaymentEntity.Issuer, transactionPayload.PaymentEntity.Number, transactionPayload.PaymentEntity.SixID].includes(cfg.entityProperty)
  })

  if (feeEntityPropertyExactMatchConfig.length !== 0) {
    mostSuitableConfig = feeEntityPropertyExactMatchConfig
  } else {
    mostSuitableConfig = mostSuitableConfig.filter(cfg => cfg.entityProperty === '*')
  }

  if (mostSuitableConfig.length === 0) {
    return mostSuitableConfig;
  }

  return mostSuitableConfig.pop();
};

const calcAppliedFeeValue = (configFeeSpec, transactionFeePayload ) => {
  let appliedFeeValue;
  const configFlatFeeValue = Number(configFeeSpec.flatFeeValue);
  const configFeeValue = Number(configFeeSpec.feeValue);
  
  switch (configFeeSpec.feeType) {
    case 'FLAT':
      appliedFeeValue = configFlatFeeValue;
      break;
    case 'PERC':
      appliedFeeValue = ((configFeeValue * transactionFeePayload.Amount) / 100);
      break;
    case 'FLAT_PERC':
      appliedFeeValue = (configFlatFeeValue + (Number(configFeeSpec.feeValue) * transactionFeePayload.Amount) / 100);
      break;
  }
  return appliedFeeValue;
};

const calcChargeAmount = (appliedFeeValue, transactionFeePayload) => {
  let chargeAmount;
  if (transactionFeePayload.Customer.BearsFee) {
    chargeAmount = transactionFeePayload.Amount + appliedFeeValue
  } else {
    chargeAmount = transactionFeePayload.Amount
  }

  return chargeAmount;
};

const hashConfigSpec = async (feeConfigSpec) => {
  for (let i = 0; i < feeConfigSpec.length; i++) {
    await Promise.all([
      redisClient.hSet(`configSpec:${i + 1}`, 'feeId', feeConfigSpec[i].feeId),
      redisClient.hSet(`configSpec:${i + 1}`, 'feeCurrency', feeConfigSpec[i].feeCurrency),
      redisClient.hSet(`configSpec:${i + 1}`, 'feeLocale', feeConfigSpec[i].feeLocale),
      redisClient.hSet(`configSpec:${i + 1}`, 'feeEntity', feeConfigSpec[i].feeEntity),
      redisClient.hSet(`configSpec:${i + 1}`, 'entityProperty', feeConfigSpec[i].entityProperty),
      redisClient.hSet(`configSpec:${i + 1}`, 'feeType', feeConfigSpec[i].feeType),
      redisClient.hSet(`configSpec:${i + 1}`, 'flatFeeValue', feeConfigSpec[i].flatFeeValue),
      redisClient.hSet(`configSpec:${i + 1}`, 'feeValue', feeConfigSpec[i].feeValue)
    ]);
  }
}