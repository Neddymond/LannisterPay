const express = require('express'),
  router = express.Router();

const controller = require('../api/controllers/controller');

router.post('/fees',  controller.parseFeeConfigSpec)
router.post('/compute-transaction-fee', controller.computeTransactionFee);

module.exports = router;