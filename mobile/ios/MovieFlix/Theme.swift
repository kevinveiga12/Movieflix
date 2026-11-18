import SwiftUI

/// Paleta idêntica ao site (src/styles/global.css) e ao app Android.
enum MF {
    static let red = Color(red: 0xDF / 255, green: 0x0A / 255, blue: 0x15 / 255)
    static let redBright = Color(red: 0xFF / 255, green: 0x2D / 255, blue: 0x2D / 255)
    static let redDark = Color(red: 0xB0 / 255, green: 0x07 / 255, blue: 0x10 / 255)
    static let purple = Color(red: 0x8B / 255, green: 0x5C / 255, blue: 0xF6 / 255)

    static let bg = Color(red: 0x0A / 255, green: 0x0A / 255, blue: 0x0F / 255)
    static let bgElev = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x18 / 255)
    static let bgCard = Color(red: 0x17 / 255, green: 0x17 / 255, blue: 0x1F / 255)
    static let bgHover = Color(red: 0x1F / 255, green: 0x1F / 255, blue: 0x2A / 255)

    static let text = Color.white
    static let textSoft = Color(red: 0xD8 / 255, green: 0xD8 / 255, blue: 0xE2 / 255)
    static let textMuted = Color(red: 0x9A / 255, green: 0x9A / 255, blue: 0xAB / 255)
    static let textDim = Color(red: 0x6B / 255, green: 0x6B / 255, blue: 0x7B / 255)

    static let success = Color(red: 0x10 / 255, green: 0xB9 / 255, blue: 0x81 / 255)
    static let warning = Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)
    static let danger = Color(red: 0xEF / 255, green: 0x44 / 255, blue: 0x44 / 255)

    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.16)
}

/// Botão da marca.
struct MFButtonStyle: ButtonStyle {
    var primary: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(primary ? MF.red : MF.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

/// Campo de texto com a identidade do MovieFlix.
struct MFField: View {
    let label: String
    @Binding var text: String
    var secure: Bool = false
    var keyboard: UIKeyboardType = .default

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(MF.textDim)
            Group {
                if secure {
                    SecureField("", text: $text)
                } else {
                    TextField("", text: $text)
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .foregroundStyle(MF.text)
            .padding(12)
            .background(MF.bgCard)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10).stroke(MF.border, lineWidth: 1)
            )
        }
    }
}
