use crate::base32::base32_decode;
use crate::error::OtpError;
use crate::model::{OtpAlgorithm, OtpType, ParsedOtp};
use url::Url;

/// Parse an `otpauth://totp/...` or `otpauth://hotp/...` URI into [`ParsedOtp`].
/// Defaults follow the Key Uri Format: SHA1, 6 digits, 30s period, counter 0.
pub fn parse_otpauth(uri: &str) -> Result<ParsedOtp, OtpError> {
    let url = Url::parse(uri).map_err(|_| OtpError::InvalidUri)?;
    if url.scheme() != "otpauth" {
        return Err(OtpError::UnsupportedScheme);
    }

    let otp_type = match url.host_str() {
        Some("totp") => OtpType::Totp,
        Some("hotp") => OtpType::Hotp,
        _ => return Err(OtpError::UnsupportedScheme),
    };

    // Label is the path (minus the leading '/'), percent-decoded. It may be
    // "Issuer:Account".
    let raw_label = url.path().trim_start_matches('/');
    let label_decoded = percent_encoding::percent_decode_str(raw_label)
        .decode_utf8_lossy()
        .into_owned();
    let (mut issuer, label) = match label_decoded.split_once(':') {
        Some((iss, acc)) => (iss.trim().to_string(), acc.trim().to_string()),
        None => (String::new(), label_decoded),
    };

    let mut secret_b32: Option<String> = None;
    let mut algorithm = OtpAlgorithm::Sha1;
    let mut digits: u8 = 6;
    let mut period: u32 = 30;
    let mut counter: u64 = 0;

    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "secret" => secret_b32 = Some(v.into_owned()),
            "issuer" => {
                if issuer.is_empty() {
                    issuer = v.into_owned();
                }
            }
            "algorithm" => {
                algorithm = match v.to_ascii_uppercase().as_str() {
                    "SHA1" => OtpAlgorithm::Sha1,
                    "SHA256" => OtpAlgorithm::Sha256,
                    "SHA512" => OtpAlgorithm::Sha512,
                    _ => return Err(OtpError::UnsupportedAlgorithm),
                }
            }
            "digits" => digits = v.parse().map_err(|_| OtpError::InvalidDigits)?,
            "period" => period = v.parse().map_err(|_| OtpError::InvalidUri)?,
            "counter" => counter = v.parse().map_err(|_| OtpError::InvalidUri)?,
            _ => {}
        }
    }

    let secret_b32 = secret_b32.ok_or(OtpError::MissingSecret)?;
    let secret = base32_decode(&secret_b32)?;
    if secret.is_empty() {
        return Err(OtpError::MissingSecret);
    }
    if !(6..=10).contains(&digits) {
        return Err(OtpError::InvalidDigits);
    }

    Ok(ParsedOtp {
        issuer,
        label,
        otp_type,
        algorithm,
        digits,
        period,
        counter,
        secret,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_full_totp_uri() {
        let p = parse_otpauth(
            "otpauth://totp/ACME%20Co:john@example.com\
             ?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=ACME%20Co\
             &algorithm=SHA256&digits=8&period=60",
        )
        .unwrap();
        assert_eq!(p.issuer, "ACME Co");
        assert_eq!(p.label, "john@example.com");
        assert_eq!(p.otp_type, OtpType::Totp);
        assert_eq!(p.algorithm, OtpAlgorithm::Sha256);
        assert_eq!(p.digits, 8);
        assert_eq!(p.period, 60);
        assert_eq!(p.secret, b"12345678901234567890");
    }

    #[test]
    fn applies_defaults_and_parses_hotp_counter() {
        let p = parse_otpauth("otpauth://hotp/me?secret=GEZDGNBVGY3TQOJQ&counter=7").unwrap();
        assert_eq!(p.issuer, "");
        assert_eq!(p.label, "me");
        assert_eq!(p.otp_type, OtpType::Hotp);
        assert_eq!(p.algorithm, OtpAlgorithm::Sha1);
        assert_eq!(p.digits, 6);
        assert_eq!(p.period, 30);
        assert_eq!(p.counter, 7);
    }

    #[test]
    fn rejects_missing_secret_and_bad_scheme() {
        assert_eq!(
            parse_otpauth("otpauth://totp/me"),
            Err(OtpError::MissingSecret)
        );
        assert_eq!(
            parse_otpauth("https://totp/me?secret=GEZDGNBVGY3TQOJQ"),
            Err(OtpError::UnsupportedScheme)
        );
        assert_eq!(
            parse_otpauth("otpauth://sms/me?secret=GEZDGNBVGY3TQOJQ"),
            Err(OtpError::UnsupportedScheme)
        );
    }
}
