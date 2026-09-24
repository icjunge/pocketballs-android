package com.idleballs.pocket;

/** Converts Android's [x,y,z,w] rotation vector to its gravity-sensor convention.
 * The third row of device-to-world rotation is world up in device coordinates.
 * GravityMapper subsequently reverses it to physical down and remaps the display.
 * Pure Java so the complete quaternion -> screen contract can be host-tested.
 */
public final class RotationGravity {
    public static final float EARTH_GRAVITY = 9.80665f;
    private RotationGravity() { }

    public static boolean toSensor(float[] vector, float[] out) {
        if (vector == null || vector.length < 3 || out == null || out.length < 3)
            return false;
        double x = vector[0], y = vector[1], z = vector[2];
        double w = vector.length >= 4 ? vector[3]
            : Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
        double normSquared = x * x + y * y + z * z + w * w;
        if (!Double.isFinite(normSquared) || normSquared < 0.25 || normSquared > 4)
            return false;
        double scale = 2 / normSquared;
        out[0] = (float) ((x * z - y * w) * scale * EARTH_GRAVITY);
        out[1] = (float) ((y * z + x * w) * scale * EARTH_GRAVITY);
        out[2] = (float) ((1 - (x * x + y * y) * scale) * EARTH_GRAVITY);
        return true;
    }

    /** Only used on devices with no fused orientation/gravity sensor. */
    public static float accelerometerBlend(long deltaNanos) {
        double dt = Math.min(0.1, Math.max(0.001, deltaNanos / 1_000_000_000.0));
        return (float) (1 - Math.exp(-dt / 0.075));
    }
}
