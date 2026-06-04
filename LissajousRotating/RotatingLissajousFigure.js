import Lissajous from "../Lissajous/LissajousFigure.js";
import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";

export default class RotatingLissajousFigure extends Lissajous {
	constructor(
		center,
		cellSize,
		omega1,
		omega2,
		phaseshift1,
		phaseshift2,
		showHorizontalLine = false,
		showVerticalLine = false
	) {
		super(center, cellSize, omega1, omega2, phaseshift1, phaseshift2, showHorizontalLine, showVerticalLine);
	}

	DrawWholeFigure(bgContext, fgContext, opacity = 1.0) {
		const t = helpers.range(0, 6.28, 0.01);
		bgContext.save();
		bgContext.lineWidth = 2;
		bgContext.globalAlpha = opacity;
		for (let i = 0; i < t.length - 1; i++) {
			const hue = (t[i] / 6.28 * 360) % 360;
			bgContext.strokeStyle = `hsl(${hue}, 100%, 78%)`;
			const pos = this.center.Add(this.CalcXY(t[i]));
			const newPos = this.center.Add(this.CalcXY(t[i + 1]));
			bgContext.beginPath();
			bgContext.moveTo(pos.x, pos.y);
			bgContext.lineTo(newPos.x, newPos.y);
			bgContext.stroke();
		}
		bgContext.restore();

	}
}
