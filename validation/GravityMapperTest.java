package com.idleballs.pocket;

/** Run with a regular JDK: no emulator needed for the sensor coordinate contract. */
public final class GravityMapperTest {
    private static int count;
    private static void check(String label, int rotation, float[] sensor, float[] expected) {
        float[] actual = new float[3];
        GravityMapper.toScreen(sensor[0], sensor[1], sensor[2], rotation, actual);
        for (int axis = 0; axis < 3; axis++)
            if (Math.abs(actual[axis] - expected[axis]) > 0.0001f)
                throw new AssertionError(label + " rotation=" + rotation + " axis=" + axis
                    + " expected=" + expected[axis] + " actual=" + actual[axis]);
        count++;
    }
    public static void main(String[] args) {
        float[][] right = {{-6,0,8},{0,6,8},{6,0,8},{0,-6,8}};
        float[][] bottom = {{0,6,8},{6,0,8},{0,-6,8},{-6,0,8}};
        for (int rotation = 0; rotation < 4; rotation++) {
            check("right edge lower",rotation,right[rotation],new float[]{6,0,-8});
            check("bottom edge lower",rotation,bottom[rotation],new float[]{0,-6,-8});
            check("left edge lower",rotation,
                new float[]{-right[rotation][0],-right[rotation][1],8},new float[]{-6,0,-8});
            check("top edge lower",rotation,
                new float[]{-bottom[rotation][0],-bottom[rotation][1],8},new float[]{0,6,-8});
            check("face-up",rotation,new float[]{0,0,9.80665f},new float[]{0,0,-9.80665f});
            check("face-down",rotation,new float[]{0,0,-9.80665f},new float[]{0,0,9.80665f});
        }
        System.out.println("PASS: " + count + " gravity mappings across all 4 display rotations");
    }
}
