import Foundation

/// These names match UIInterfaceOrientation, NOT UIDeviceOrientation.
/// UIKit landscapeLeft has the charging port on the left; the device-orientation
/// enum calls that same physical position landscapeRight.
enum PocketScreenOrientation: CaseIterable {
    case portrait, portraitUpsideDown, landscapeLeft, landscapeRight
}

struct PocketGravity: Equatable {
    let x: Double
    let y: Double
    let z: Double
}

enum MotionGravity {
    static let standardGravity = 9.80665

    /// Core Motion gravity already points DOWN, in g: never negate it as Android
    /// sensor gravity requires. Output uses screen X right, Y up, Z toward viewer.
    static func screen(x: Double, y: Double, z: Double,
                       orientation: PocketScreenOrientation) -> PocketGravity? {
        guard x.isFinite, y.isFinite, z.isFinite else { return nil }
        let horizontal: Double
        let vertical: Double
        switch orientation {
        case .portrait: horizontal = x; vertical = y
        case .portraitUpsideDown: horizontal = -x; vertical = -y
        case .landscapeLeft: horizontal = y; vertical = -x
        case .landscapeRight: horizontal = -y; vertical = x
        }
        return PocketGravity(x: horizontal * standardGravity,
                             y: vertical * standardGravity,
                             z: z * standardGravity)
    }
}
