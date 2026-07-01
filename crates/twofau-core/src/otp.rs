use crate::model::OtpAlgorithm;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

fn hmac_sha1(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha1>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(msg);
    mac.finalize().into_bytes().to_vec()
}

fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(msg);
    mac.finalize().into_bytes().to_vec()
}

fn hmac_sha512(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut mac = Hmac::<Sha512>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(msg);
    mac.finalize().into_bytes().to_vec()
}

/// RFC 4226 HOTP. `digits` is the code length (6–10).
pub fn hotp(secret: &[u8], counter: u64, digits: u8, algo: OtpAlgorithm) -> String {
    let msg = counter.to_be_bytes();
    let hash = match algo {
        OtpAlgorithm::Sha1 => hmac_sha1(secret, &msg),
        OtpAlgorithm::Sha256 => hmac_sha256(secret, &msg),
        OtpAlgorithm::Sha512 => hmac_sha512(secret, &msg),
    };

    // Dynamic truncation (RFC 4226 §5.3).
    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let bin = ((hash[offset] as u32 & 0x7f) << 24)
        | ((hash[offset + 1] as u32) << 16)
        | ((hash[offset + 2] as u32) << 8)
        | (hash[offset + 3] as u32);

    let modulo = 10u64.pow(digits as u32);
    let code = bin as u64 % modulo;
    format!("{:0width$}", code, width = digits as usize)
}

/// RFC 6238 TOTP: HOTP over the counter `unix_time / period`.
pub fn totp(secret: &[u8], unix_time: u64, period: u32, digits: u8, algo: OtpAlgorithm) -> String {
    let counter = unix_time / period.max(1) as u64;
    hotp(secret, counter, digits, algo)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED_SHA1: &[u8] = b"12345678901234567890";
    const SEED_SHA256: &[u8] = b"12345678901234567890123456789012";
    const SEED_SHA512: &[u8] = b"1234567890123456789012345678901234567890123456789012345678901234";

    #[test]
    fn hotp_rfc4226_appendix_d() {
        let expected = [
            "755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583",
            "399871", "520489",
        ];
        for (counter, code) in expected.iter().enumerate() {
            assert_eq!(
                &hotp(SEED_SHA1, counter as u64, 6, OtpAlgorithm::Sha1),
                code
            );
        }
    }

    #[test]
    fn totp_rfc6238_appendix_b() {
        // (time, sha1, sha256, sha512), 8 digits, period 30.
        let cases = [
            (59u64, "94287082", "46119246", "90693936"),
            (1111111109, "07081804", "68084774", "25091201"),
            (1111111111, "14050471", "67062674", "99943326"),
            (1234567890, "89005924", "91819424", "93441116"),
            (2000000000, "69279037", "90698825", "38618901"),
            (20000000000, "65353130", "77737706", "47863826"),
        ];
        for (t, s1, s256, s512) in cases {
            assert_eq!(
                totp(SEED_SHA1, t, 30, 8, OtpAlgorithm::Sha1),
                s1,
                "sha1 @ {t}"
            );
            assert_eq!(
                totp(SEED_SHA256, t, 30, 8, OtpAlgorithm::Sha256),
                s256,
                "sha256 @ {t}"
            );
            assert_eq!(
                totp(SEED_SHA512, t, 30, 8, OtpAlgorithm::Sha512),
                s512,
                "sha512 @ {t}"
            );
        }
    }
}
