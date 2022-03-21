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
        // console.log('split ======> ', splitConfigSpec);
        const entity = splitConfigSpec[3].split(/[()]/);
        // console.log('entity ======> ', entity);
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
          feeValue: splitConfigSpec[6] === 'FLAT' ? Number(splitConfigSpec[7]) : splitConfigSpec[7].match(':') ? Number(splitConfigSpec[7].split(':')[0]) : null,
          feePercentage: splitConfigSpec[6] === 'PERC' ? Number(splitConfigSpec[7]) : splitConfigSpec[7].match(':') ? Number(splitConfigSpec[7].split(':')[1]) : null,
        });
      }

      console.log('config spec ====> ', allConfig);
    }

    await hashConfigSpec(allConfig);
    
    const newFeeConfigurationSpec = await FeeConfigurationSpec.insertMany(allConfig);
    if (!newFeeConfigurationSpec) {
      handleError('Couldn\'t create fee config spec', res, 400);
    }
    console.log('feeConfigSpec =======> ', newFeeConfigurationSpec);

    return res.status(200).send({ status: 'ok' });
  } catch (error) {
    console.log('error ====> ', error);
    handleError(error.message, res, 500);
  }
}

exports.computeTransactionFee = async (req, res) => {
  try {
    const transactionFeePayload = req.body;
    let feeConfigSpec = [];
    console.log('keys ===> ', (await redisClient.scan(0)).keys);

    if ((await redisClient.scan(0)).keys && (await redisClient.scan(0)).keys.length > 0) {
      console.log('=====> Inside hash');
      for (const key of (await redisClient.scan(0)).keys) {
        feeConfigSpec.push(JSON.parse(JSON.stringify(await redisClient.hGetAll(key))));
        // console.log('redis fee config spec ===> ', feeConfigSpec);
      }
    } else {
      console.log('====> Outside hash');
      feeConfigSpec = await FeeConfigurationSpec.find({});
      if (!feeConfigSpec) {
        return handleError('Config spec not found to compute this transaction', res, 404);
      }
      await hashConfigSpec(feeConfigSpec);
    }
    
    // console.log('fetched config ====>', feeConfigSpec);

    const mostSuitableCofigSpec =  findMostSuitableFeeConfigSpec(feeConfigSpec, transactionFeePayload);
    if (!mostSuitableCofigSpec || mostSuitableCofigSpec.length === 0) {
      return handleError('No fee configuration is applicable to this transaction', res, 400);
    }

    console.log('most suitable config spec =======> ', mostSuitableCofigSpec);

    const appliedFeeValue = calcAppliedFeeValue(mostSuitableCofigSpec, transactionFeePayload);
    if (!appliedFeeValue) {
      return handleError('Can\'t compute applied fee value');
    }
    console.log('applied fee value ====> ', appliedFeeValue);

    const chargeAmount = calcChargeAmount(appliedFeeValue, transactionFeePayload);
    console.log('charge amount =====> ', chargeAmount);

    const settleAmount = chargeAmount - appliedFeeValue;
    console.log('settlement amount ====> ', settleAmount);

    return res.status(200).send({
      'AppliedFeeID': mostSuitableCofigSpec.feeId,
      'AppliedFeeValue': appliedFeeValue,
      'ChargeAmount': chargeAmount,
      'SettlementAmount': settleAmount
    });

  } catch (error) {
    console.log('transaction error ======> ', error);
    handleError(error.message, res, 500);
  }
}

const findMostSuitableFeeConfigSpec = (feeConfigSpec, transactionPayload) => {
  const payloadLocale = transactionPayload.PaymentEntity.Country === transactionPayload.CurrencyCountry ? 'LOCL' : 'INTL';
  console.log(payloadLocale)
  let mostSuitableConfig = [];

  // currency check
  mostSuitableConfig = feeConfigSpec.filter(cfg => cfg.feeCurrency === transactionPayload.Currency);

  if (mostSuitableConfig.length === 0) {
    return mostSuitableConfig;
  }

  // console.log('after currency check ====> ', mostSuitableConfig);

  // feeEntity
  const feeEntityExactMatchConfig = mostSuitableConfig.filter(cfg => cfg.feeEntity === transactionPayload.PaymentEntity.Type)

  // const feeEntityExactMatchConfig = mostSuitableConfig.filter(cfg => R.allPass([
  //   R.propEq('feeEntity', cfg.feeEntity, transactionPayload.PaymentEntity.Type),
  //   R.propEq('feeEntity', '*', transactionPayload.PaymentEntity.Type)
  // ]));

  if (feeEntityExactMatchConfig.length !== 0) {
    mostSuitableConfig = feeEntityExactMatchConfig
  } else {
    matchConfigs = matchConfigs.filter(cfg => cfg.feeEntity === '*')
  }

  if (mostSuitableConfig.length === 0) {
    return mostSuitableConfig;
  }
  
  // console.log('after fee entity check ====> ', mostSuitableConfig);


  // feeLocal check
  const feeLocaleExactMatchConfig = mostSuitableConfig.filter(cfg => cfg.feeLocale === payloadLocale)
  if (feeLocaleExactMatchConfig.length !== 0) {
    mostSuitableConfig = feeLocaleExactMatchConfig
  } else {
    mostSuitableConfig = mostSuitableConfig.filter(cfg => cfg.feeLocale === '*')
  }


  if (mostSuitableConfig.length === 0) {
    return mostSuitableConfig;
  }

  // console.log('after fee local check ====> ', mostSuitableConfig);

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

  // console.log('after entity property check ===> ', mostSuitableConfig);

  return mostSuitableConfig.pop();
};

const calcAppliedFeeValue = (configFeeSpec, transactionFeePayload ) => {
  let appliedFeeValue;
  const configFeeValue = Number(configFeeSpec.feeValue);
  
  switch (configFeeSpec.feeType) {
    case 'FLAT':
      appliedFeeValue = configFeeValue;
      break;
    case 'PERC':
      appliedFeeValue = ((configFeeValue * transactionFeePayload.Amount) / 100);
      break;
    case 'FLAT_PERC':
      appliedFeeValue = (configFeeValue + (Number(configFeeSpec.feePercentage) * transactionFeePayload.Amount) / 100);
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
    await redisClient.hSet(`configSpec:${i + 1}`, 'feeId', feeConfigSpec[i].feeId);
    await redisClient.hSet(`configSpec:${i + 1}`, 'feeCurrency', feeConfigSpec[i].feeCurrency);
    await redisClient.hSet(`configSpec:${i + 1}`, 'feeLocale', feeConfigSpec[i].feeLocale);
    await redisClient.hSet(`configSpec:${i + 1}`, 'feeEntity', feeConfigSpec[i].feeEntity);
    await redisClient.hSet(`configSpec:${i + 1}`, 'entityProperty', feeConfigSpec[i].entityProperty);
    await redisClient.hSet(`configSpec:${i + 1}`, 'feeType', feeConfigSpec[i].feeType);
    await redisClient.hSet(`configSpec:${i + 1}`, 'feeValue', feeConfigSpec[i].feeValue);
    await redisClient.hSet(`configSpec:${i + 1}`, 'feePercentage', feeConfigSpec[i].feePercentage);
  }
}