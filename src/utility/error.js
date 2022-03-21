exports.handleError = (err, res, status) => {
  let data = {};
  status = !status ? 400 : status;
  let message = typeof(err) === 'string' ? err : err.message;

  data['success'] = false;
  data['message'] = message;
  data['data'] = {};

  res.status(status).json(data);
};