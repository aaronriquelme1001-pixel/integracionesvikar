const axios = require('axios');

/**
 * Base Class for all B2B Telemetry Forwarding Strategies.
 * Provides helper methods for parsing parameters, dates, and sending JSON/SOAP payloads.
 */
class BaseStrategy {
  /**
   * Helper to parse GPS Server parameters string into an object.
   */
  parseParams(params) {
    if (!params) return {};

    // 1. If it is already a parsed JSON object, return it
    if (typeof params === 'object') {
      return params;
    }

    // 2. If it is a JSON string, parse it
    if (typeof params === 'string' && params.trim().startsWith('{')) {
      try {
        return JSON.parse(params);
      } catch (err) {
        console.warn(`[BaseStrategy] Warning: Error parsing JSON params: ${err.message}. Falling back to pipe parser.`);
      }
    }

    // 3. Fallback: Parse pipe-separated string
    const result = {};
    const parts = String(params).split('|');
    for (const part of parts) {
      if (part) {
        const kv = part.split('=');
        if (kv.length === 2) {
          result[kv[0]] = kv[1];
        }
      }
    }
    return result;
  }

  /**
   * Helper to format dates.
   * Converts "YYYY-MM-DD HH:mm:ss" to different target formats.
   */
  formatDate(dtStr, format = 'ISO') {
    if (!dtStr) {
      dtStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    }

    if (format === 'DD-MM-YYYY HH:mm:ss') {
      // E.g. "2026-05-27 13:22:00" -> "27-05-2026 13:22:00"
      const parts = dtStr.split(' ');
      if (parts.length === 2) {
        const dateParts = parts[0].split('-');
        if (dateParts.length === 3) {
          return `${dateParts[2]}-${dateParts[1]}-${dateParts[0]} ${parts[1]}`;
        }
      }
      return dtStr;
    }

    if (format === 'ISO_T') {
      // E.g. "2026-05-27 13:22:00" -> "2026-05-27T13:22:00"
      return dtStr.replace(' ', 'T');
    }

    return dtStr;
  }

  /**
   * Helper to dispatch SOAP XML Requests.
   */
  async sendSOAPRequest(url, soapAction, soapEnvelope) {
    try {
      const response = await axios.post(url, soapEnvelope, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': soapAction
        },
        timeout: 10000
      });
      return { success: true, data: response.data };
    } catch (error) {
      const errorMsg = error.response ? error.response.data : error.message;
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Helper to dispatch HTTP JSON POST Requests.
   */
  async sendJSONRequest(url, headers, payload) {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        timeout: 10000
      });
      return { success: true, data: response.data };
    } catch (error) {
      const errorMsg = error.response ? error.response.data : error.message;
      return { success: false, error: errorMsg };
    }
  }
}

module.exports = BaseStrategy;
