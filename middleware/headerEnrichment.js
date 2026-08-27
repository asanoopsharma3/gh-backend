const MSISDN_HEADER_KEYS = [
  "msisdn",
  "x-msisdn",
  "x-up-calling-line-id",
  "x-forwarded-msisdn",
  "x-nokia-msisdn",
  "x-mdn",
  "x-ht-msisdn",
  "x-up-subno",
  "x-subscriber",
];

const getHeaderMsisdn = (req) => {
  const headers = req.headers || {};
  for (const key of MSISDN_HEADER_KEYS) {
    const raw = headers[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) return value;
  }
  return null;
};

const headerEnrichment = (req, res, next) => {
  const msisdn = getHeaderMsisdn(req);
  if (msisdn) {
    req.msisdn = msisdn;
  }
  next();
};

export default headerEnrichment;
