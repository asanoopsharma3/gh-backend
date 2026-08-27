const getHeaderMsisdn = (req) =>
  req.headers.msisdn ||
  req.headers["x-msisdn"] ||
  req.headers["x-up-calling-line-id"] ||
  null;

const headerEnrichment = (req, res, next) => {
  const msisdn = getHeaderMsisdn(req);
  if (msisdn) {
    req.msisdn = msisdn;
  }
  next();
};

export default headerEnrichment;
