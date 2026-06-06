// Default simulation config + named parameter presets.
// Seeds mirror PavelDoGreat/WebGL-Fluid-Simulation, then tuned for the obstacle showcase.

export const config = {
	SIM_RESOLUTION: 128,
	DYE_RESOLUTION: 2048,
	DENSITY_DISSIPATION: 0.85,  // dye fade rate
	VELOCITY_DISSIPATION: 1.0,  // "friction"
	PRESSURE: 0.2,
	PRESSURE_ITERATIONS: 21,
	CURL: 9,                    // vorticity / swirliness
	SPLAT_RADIUS: 0.35,
	SPLAT_FORCE: 6500,
	SHADING: true,
	COLORFUL: true,
	COLOR_UPDATE_SPEED: 13.5,
	COLOR_MODE: 'rainbow',      // rainbow | single | gradient | velocity
	PAUSED: false,
	BACK_COLOR: { r: 13, g: 11, b: 20 },
	TRANSPARENT: true,
	BLOOM: true,
	BLOOM_ITERATIONS: 8,
	BLOOM_RESOLUTION: 256,
	BLOOM_INTENSITY: 0.1,
	BLOOM_THRESHOLD: 0.5,
	BLOOM_SOFT_KNEE: 0.7,
	SUNRAYS: true,
	SUNRAYS_RESOLUTION: 196,
	SUNRAYS_WEIGHT: 0.2,
	OBSTACLE_BRUSH: 0.025,      // brush radius, fraction of width
	EMITTER: false,            // continuous left-edge inflow (drives the vortex-street demo)
	EMITTER_FORCE: 1400,
};
