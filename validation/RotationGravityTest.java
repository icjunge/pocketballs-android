package com.idleballs.pocket;

/** Host checks for orientation input -> screen gravity, including yaw independence. */
public final class RotationGravityTest {
    private static int checks;
    private static final float G = RotationGravity.EARTH_GRAVITY;
    private static void near(String label, float actual, float expected) {
        if (Math.abs(actual - expected) > 0.00005f)
            throw new AssertionError(label + ": " + actual + " != " + expected);
        checks++;
    }
    private static void truth(String label, boolean value) {
        if (!value) throw new AssertionError(label);
        checks++;
    }
    private static float[] tilt(float sensorX, float sensorY) {
        // Rotate the tilted device's up-vector onto world +Z.
        double length = Math.hypot(sensorX, sensorY);
        double angle = Math.asin(length);
        if (length == 0) return new float[]{0, 0, 0, 1};
        return new float[]{(float)(sensorY / length * Math.sin(angle / 2)),
            (float)(-sensorX / length * Math.sin(angle / 2)), 0,
            (float)Math.cos(angle / 2)};
    }
    private static float[] worldYaw(float[] q, double angle) {
        float s = (float)Math.sin(angle / 2), c = (float)Math.cos(angle / 2);
        return new float[]{c*q[0]-s*q[1], c*q[1]+s*q[0],
            c*q[2]+s*q[3], c*q[3]-s*q[2]};
    }
    private static void checkDirection(int rotation, float sx, float sy,
                                       float screenX, float screenY) {
        float[] sensor = new float[3], screen = new float[3];
        for (double yaw : new double[]{0, .7, 2.1, -2.8}) {
            truth("valid quaternion", RotationGravity.toSensor(worldYaw(tilt(sx,sy),yaw),sensor));
            GravityMapper.toScreen(sensor[0],sensor[1],sensor[2],rotation,screen);
            near("screen x rotation="+rotation,screen[0],screenX*G);
            near("screen y rotation="+rotation,screen[1],screenY*G);
            near("screen z rotation="+rotation,screen[2],-.8f*G);
        }
    }
    public static void main(String[] args) {
        float[][] right={{-.6f,0},{0,.6f},{.6f,0},{0,-.6f}};
        float[][] bottom={{0,.6f},{.6f,0},{0,-.6f},{-.6f,0}};
        for(int r=0;r<4;r++) {
            checkDirection(r,right[r][0],right[r][1],.6f,0);
            checkDirection(r,-right[r][0],-right[r][1],-.6f,0);
            checkDirection(r,bottom[r][0],bottom[r][1],0,-.6f);
            checkDirection(r,-bottom[r][0],-bottom[r][1],0,.6f);
        }
        float[] result = new float[3];
        truth("face up",RotationGravity.toSensor(new float[]{0,0,0,1},result));
        near("face up sensor",result[2],G);
        truth("face down",RotationGravity.toSensor(new float[]{1,0,0,0},result));
        near("face down sensor",result[2],-G);
        float[] tilted=tilt(-.6f,0);
        truth("optional w",RotationGravity.toSensor(new float[]{tilted[0],tilted[1],0},result));
        near("optional w x",result[0],-.6f*G);
        truth("reject NaN",!RotationGravity.toSensor(new float[]{0,0,0,Float.NaN},result));
        truth("reject zero quaternion",!RotationGravity.toSensor(new float[]{0,0,0,0},result));

        // A step in a fused orientation sample is applied in full immediately, with no
        // application-level low-pass. This is algorithmic latency, not a device benchmark.
        RotationGravity.toSensor(new float[]{0,0,0,1},result);
        RotationGravity.toSensor(tilted,result);
        near("first tilted sample fully applied",result[0],-.6f*G);
        float fallback=0;
        int fallbackSamples=0;
        while(fallback<.9f && fallbackSamples<1000) {
            fallback+=RotationGravity.accelerometerBlend(8_333_333L)*(1-fallback);
            fallbackSamples++;
        }
        truth("accelerometer fallback t90 <= 184ms",fallbackSamples*8_333_333L<=184_000_000L);
        System.out.println("PASS: "+checks+" quaternion/rotation/step checks; fused input = first sample;"
            +" accel fallback t90="+(fallbackSamples*8_333_333L/1_000_000.0)+"ms");
    }
}
