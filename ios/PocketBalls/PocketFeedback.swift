import UIKit
import AVFAudio
import QuartzCore

/// Short, pooled impacts. Nothing in this engine records audio or runs in background.
final class PocketFeedback {
    private var players: [String: [AVAudioPlayer]] = [:]
    private let impact = UIImpactFeedbackGenerator(style: .soft)
    private var active = false
    private var interactionActive = true
    private var soundEnabled = true
    private var hapticsEnabled = true
    private var audioActive = false
    private var lastSound: CFTimeInterval = -.infinity
    private var lastHaptic: CFTimeInterval = -.infinity

    init(bundle: Bundle = .main) {
        // Ambient respects the hardware Silent setting and mixes with other audio.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        guard let root = bundle.resourceURL?.appendingPathComponent("assets/audio", isDirectory: true) else { return }
        for type in ["soccer", "tennis", "basketball", "volleyball"] {
            let file = root.appendingPathComponent(type + ".wav")
            players[type] = (0..<3).compactMap { _ in
                guard let player = try? AVAudioPlayer(contentsOf: file) else { return nil }
                player.prepareToPlay()
                return player
            }
        }
    }

    func setActive(_ value: Bool) {
        active = value
        if value, interactionActive, hapticsEnabled {
            impact.prepare()
        }
        if !value {
            stopAudio()
            lastSound = -.infinity
            lastHaptic = -.infinity
        }
    }

    func setPreferences(active: Bool, sound: Bool, haptics: Bool) {
        interactionActive = active
        soundEnabled = sound
        hapticsEnabled = haptics
        if !active || !sound { stopAudio() }
        if self.active, active, haptics { impact.prepare() }
    }

    private func stopAudio() {
        for pool in players.values { for player in pool { player.stop() } }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        audioActive = false
    }

    func play(type: String, strength: Double, sound: Bool, haptics: Bool) {
        guard active, interactionActive, strength.isFinite, let pool = players[type] else { return }
        let value = min(1, max(0, strength))
        guard value >= 0.035 else { return }
        let now = CACurrentMediaTime()
        // Contacts in a packed pile coalesce; vibration never becomes a motor hum.
        if haptics, hapticsEnabled, value >= 0.09, now - lastHaptic >= 0.10 {
            impact.impactOccurred(intensity: CGFloat(0.18 + 0.55 * value))
            impact.prepare()
            lastHaptic = now
        }
        if sound, soundEnabled, now - lastSound >= 0.045,
           let player = pool.first(where: { !$0.isPlaying }) {
            if !audioActive {
                do {
                    try AVAudioSession.sharedInstance().setActive(true)
                    audioActive = true
                } catch { return }
            }
            player.currentTime = 0
            player.volume = Float(0.08 + 0.48 * value)
            if player.play() { lastSound = now }
        }
    }
}
