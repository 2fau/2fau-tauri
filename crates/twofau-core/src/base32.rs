use crate::error::OtpError;

const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Decode an RFC 4648 Base32 string. Tolerant of lowercase, whitespace, and
/// `=` padding (all ignored).
pub fn base32_decode(input: &str) -> Result<Vec<u8>, OtpError> {
    let mut out = Vec::with_capacity(input.len() * 5 / 8 + 1);
    let mut buffer: u32 = 0;
    let mut bits_left: u32 = 0;

    for c in input.chars() {
        if c == '=' || c.is_whitespace() {
            continue;
        }
        let up = c.to_ascii_uppercase() as u8;
        let val = ALPHABET
            .iter()
            .position(|&a| a == up)
            .ok_or(OtpError::InvalidBase32)? as u32;

        buffer = (buffer << 5) | val;
        bits_left += 5;
        if bits_left >= 8 {
            bits_left -= 8;
            out.push((buffer >> bits_left) as u8);
            buffer &= (1 << bits_left) - 1;
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_rfc4648_vectors() {
        assert_eq!(base32_decode("MY======").unwrap(), b"f");
        assert_eq!(base32_decode("MZXW6===").unwrap(), b"foo");
        assert_eq!(base32_decode("MZXW6YTBOI======").unwrap(), b"foobar");
    }

    #[test]
    fn tolerates_missing_padding_and_lowercase_and_spaces() {
        assert_eq!(base32_decode("mzxw6").unwrap(), b"foo");
        assert_eq!(base32_decode("MZXW 6YTB OI").unwrap(), b"foobar");
    }

    #[test]
    fn decodes_the_rfc_otp_seed() {
        // The 20-byte RFC 4226/6238 SHA1 seed.
        assert_eq!(
            base32_decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap(),
            b"12345678901234567890"
        );
    }

    #[test]
    fn rejects_invalid_characters() {
        assert_eq!(base32_decode("0189!"), Err(OtpError::InvalidBase32));
    }
}
