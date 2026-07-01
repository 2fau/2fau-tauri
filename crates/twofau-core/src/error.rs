use std::fmt;

/// Errors produced while decoding secrets or parsing `otpauth://` URIs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OtpError {
    InvalidBase32,
    InvalidUri,
    UnsupportedScheme,
    MissingSecret,
    UnsupportedAlgorithm,
    InvalidDigits,
}

impl fmt::Display for OtpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            OtpError::InvalidBase32 => "invalid Base32 secret",
            OtpError::InvalidUri => "invalid otpauth URI",
            OtpError::UnsupportedScheme => "unsupported URI scheme or OTP type",
            OtpError::MissingSecret => "otpauth URI has no secret",
            OtpError::UnsupportedAlgorithm => "unsupported HMAC algorithm",
            OtpError::InvalidDigits => "digits must be between 6 and 10",
        };
        f.write_str(msg)
    }
}

impl std::error::Error for OtpError {}
