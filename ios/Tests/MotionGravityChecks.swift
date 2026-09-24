import Foundation

@main
enum MotionGravityChecks {
    static func main() {
        var checks = 0
        let g = MotionGravity.standardGravity
        func expect(_ raw: (Double, Double, Double), _ orientation: PocketScreenOrientation,
                    _ expected: (Double, Double, Double), _ context: String) {
            guard let actual = MotionGravity.screen(x: raw.0, y: raw.1, z: raw.2, orientation: orientation),
                  abs(actual.x - expected.0 * g) < 1e-10,
                  abs(actual.y - expected.1 * g) < 1e-10,
                  abs(actual.z - expected.2 * g) < 1e-10 else {
                fatalError("Gravity mapping failed: \(context)")
            }
            checks += 1
        }
        // These input vectors represent the SAME physical lower screen edge in
        // four UI orientations. Test signs independently, not from mapper output.
        let edgeCases: [(PocketScreenOrientation, [(Double, Double, Double)])] = [
            (.portrait, [(1,0,0), (-1,0,0), (0,1,0), (0,-1,0)]),
            (.portraitUpsideDown, [(-1,0,0), (1,0,0), (0,-1,0), (0,1,0)]),
            (.landscapeLeft, [(0,1,0), (0,-1,0), (-1,0,0), (1,0,0)]),
            (.landscapeRight, [(0,-1,0), (0,1,0), (1,0,0), (-1,0,0)])
        ]
        let expectedEdges: [(Double, Double, Double)] = [(1,0,0), (-1,0,0), (0,1,0), (0,-1,0)]
        for (orientation, edges) in edgeCases {
            expect((0,0,-1), orientation, (0,0,-1), "face up \(orientation)")
            expect((0,0,1), orientation, (0,0,1), "face down \(orientation)")
            for index in edges.indices {
                expect(edges[index], orientation, expectedEdges[index], "lower edge \(index) \(orientation)")
                let raw = edges[index]
                let screen = expectedEdges[index]
                expect((raw.0 * 0.5, raw.1 * 0.5, -sqrt(0.75)), orientation,
                       (screen.0 * 0.5, screen.1 * 0.5, -sqrt(0.75)), "30 degree tilt \(orientation)")
            }
        }
        expect((0.3, -0.4, -sqrt(0.75)), .portrait, (0.3, -0.4, -sqrt(0.75)), "diagonal")
        for orientation in PocketScreenOrientation.allCases {
            for bad in [Double.nan, Double.infinity, -Double.infinity] {
                precondition(MotionGravity.screen(x: bad, y: 0, z: -1, orientation: orientation) == nil)
                precondition(MotionGravity.screen(x: 0, y: bad, z: -1, orientation: orientation) == nil)
                precondition(MotionGravity.screen(x: 0, y: 0, z: bad, orientation: orientation) == nil)
                checks += 3
            }
        }
        print("PASS: \(checks) Core Motion screen-gravity checks (four UI orientations, lower edges, tilt, invalid samples)")
    }
}
