// Default simulation config + named parameter presets.
// Seeds mirror PavelDoGreat/WebGL-Fluid-Simulation, then tuned for the obstacle showcase.

export const config = {
	SIM_RESOLUTION: 128,
	DYE_RESOLUTION: 1024,
	DENSITY_DISSIPATION: 1.0,   // dye fade rate
	VELOCITY_DISSIPATION: 0.2,  // "friction"
	PRESSURE: 0.8,
	PRESSURE_ITERATIONS: 20,
	CURL: 30,                   // vorticity / swirliness
	SPLAT_RADIUS: 0.25,
	SPLAT_FORCE: 6000,
	SHADING: true,
	COLORFUL: true,
	COLOR_UPDATE_SPEED: 10,
	COLOR_MODE: 'rainbow',      // rainbow | single | gradient | velocity
	PAUSED: false,
	BACK_COLOR: { r: 13, g: 11, b: 20 },
	TRANSPARENT: false,
	BLOOM: true,
	BLOOM_ITERATIONS: 8,
	BLOOM_RESOLUTION: 256,
	BLOOM_INTENSITY: 0.8,
	BLOOM_THRESHOLD: 0.6,
	BLOOM_SOFT_KNEE: 0.7,
	SUNRAYS: true,
	SUNRAYS_RESOLUTION: 196,
	SUNRAYS_WEIGHT: 1.0,
	OBSTACLE_BRUSH: 0.045,      // brush radius, fraction of width
	EMITTER: true,             // continuous left-edge inflow (drives the vortex-street demo)
	EMITTER_FORCE: 1400,
};
