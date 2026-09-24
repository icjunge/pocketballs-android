package com.idleballs.pocket;

/** Android gravity -> physical acceleration in current screen coordinates.
 * X right, Y screen top, Z toward viewer, in m/s². Android reports +Z face-up;
 * actual gravity is the opposite vector. Rotation constants are Surface's 0..3.
 * Kept independent of Android classes for executable JVM direction tests.
 */
public final class GravityMapper {
    private GravityMapper() {}
    public static void toScreen(float sensorX, float sensorY, float sensorZ,
                                int rotation, float[] destination) {
        float x = -sensorX, y = -sensorY;
        switch (rotation) {
            case 1: destination[0] = -y; destination[1] = x; break;
            case 2: destination[0] = -x; destination[1] = -y; break;
            case 3: destination[0] = y; destination[1] = -x; break;
            default: destination[0] = x; destination[1] = y;
        }
        destination[2] = -sensorZ;
    }
}
