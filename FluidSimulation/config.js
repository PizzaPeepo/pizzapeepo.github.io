// Default simulation config + named parameter presets.
// Seeds mirror PavelDoGreat/WebGL-Fluid-Simulation, then tuned for the obstacle showcase.

export const config = {
	SIM_RESOLUTION: 128,
	DYE_RESOLUTION: 2048,
	DENSITY_DISSIPATION: 0.25,  // dye fade rate
	VELOCITY_DISSIPATION: 1.05,  // "friction"
	PRESSURE: 0.4,
	PRESSURE_ITERATIONS: 10,
	CURL: 11,                    // vorticity / swirliness
	SPLAT_RADIUS: 0.55,
	SPLAT_FORCE: 10500,
	SHADING: true,
	COLORFUL: true,
	COLOR_UPDATE_SPEED: 5.0,
	COLOR_MODE: 'velocity',      // rainbow | single | gradient | velocity | heat
	PAUSED: false,
	BACK_COLOR: { r: 13, g: 11, b: 20 },
	TRANSPARENT: true,
	SUNRAYS: true,
	SUNRAYS_RESOLUTION: 196,
	SUNRAYS_WEIGHT: 0.15,
	OBSTACLE_BRUSH: 0.015,      // brush radius, fraction of width
	EMITTER: false,            // continuous left-edge inflow (drives the vortex-street demo)
	EMITTER_FORCE: 1400,
	ASCII: false,              // render the fluid as a colored ASCII grid
	ASCII_COLS: 120,           // glyph columns (rows derived from canvas aspect)
	ASCII_PERSIST: 0.85,       // glyph trail keep-fraction per frame (0 = off)
	ASCII_PERSIST_MODE: 'max', // 'max' phosphor (new over fading old) | 'add' additive glow
	ASCII_GLOW: true,          // CRT phosphor glow halo on the zoomed RGB-triad reveal
};
