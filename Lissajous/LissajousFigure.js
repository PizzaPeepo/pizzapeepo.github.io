import Vector2D from "../Utils/Vector2D.js";
import * as helpers from "../Utils/helpers.js";

export default class Lissajous {
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
		if (!(center instanceof Vector2D)) {
			console.log("position vector has wrong type.");
			return;
		}
		this._center = center;
		this._cellSize = cellSize;
		this._amplitude = this.CalcAmplitude();
		this._omega1 = omega1;
		this._omega2 = omega2;
		this._phaseshift1 = phaseshift1;
		this._phaseshift2 = phaseshift2;
		this._showHorizontalLine = showHorizontalLine;
		this._showVerticalLine = showVerticalLine;
	}

	Update(cellSize, omega1, omega2, phaseshift1, phaseshift2) {
		this.cellSize = cellSize;
		this.omega1 = omega1;
		this.omega2 = omega2;
		this.phaseshift1 = phaseshift1;
		this.phaseshift2 = phaseshift2;
	}

	get center() {
		return this._center;
	}

	set center(newPosVec) {
		this._center.Update(newPosVec.x, newPosVec.y);
	}

	get cellSize() {
		return this._cellSize;
	}

	set cellSize(newSize) {
		this._cellSize = newSize;
		this._amplitude = this.CalcAmplitude();
	}

	CalcAmplitude() {
		// amplitude with relative margin
		return (this._cellSize - 0.2 * this._cellSize) / 2;
	}

	get omega1() {
		return this._omega1;
	}

	set omega1(newOmega1) {
		this._omega1 = newOmega1;
	}

	get omega2() {
		return this._omega2;
	}

	set omega2(newOmega2) {
		this._omega2 = newOmega2;
	}

	get phaseshift1() {
		return this._phaseshift1;
	}

	set phaseshift1(newPhaseshift) {
		this._phaseshift1 = newPhaseshift;
	}

	get phaseshift2() {
		return this._phaseshift2;
	}

	set phaseshift2(newPhaseshift) {
		this._phaseshift2 = newPhaseshift;
	}

	get showHorizontalLine() {
		return this._showHorizontalLine;
	}

	set showHorizontalLine(val) {
		this._showHorizontalLine = val;
	}

	get showVerticalLine() {
		return this._showVerticalLine;
	}

	set showVerticalLine(val) {
		this._showVerticalLine = val;
	}

	CalcXY(t) {
		return new Vector2D(
			this._amplitude * Math.sin(this.omega1 * t + this.phaseshift1),
			this._amplitude * Math.sin(this.omega2 * t + this.phaseshift2)
		);
	}

	Clone() {
		return new Lissajous(this.center, this.amplitude, this.omega1, this.omega2, this.phaseshift1, this.phaseshift2);
	}

	Draw(bgContext, fgContext, tOld, t) {
		const oldPos = this.center.Add(this.CalcXY(tOld));
		const newPos = this.center.Add(this.CalcXY(t));
		bgContext.beginPath();
		const hue = t * 100 > 360 ? t * 100 - 360 : t * 100; // makes sure rainbowcolors are repeating
		bgContext.strokeStyle = "hsl(" + hue + ", 100%,  78%)";
		bgContext.moveTo(oldPos.x, oldPos.y);
		bgContext.lineTo(newPos.x, newPos.y);
		bgContext.stroke();

		fgContext.beginPath();
		fgContext.fillStyle = "rgba(255, 192, 203, 1.0)";
		const whiteLinestrokeStyle = "rgba(255, 255, 255, 0.3)";
		fgContext.arc(newPos.x, newPos.y, Math.ceil(this.cellSize * 0.03), 0, 2 * Math.PI);
		fgContext.fill();

		if (this.showHorizontalLine) {
			helpers.drawHorizontalLine(fgContext, newPos.y, fgContext.canvas.clientWidth, whiteLinestrokeStyle);
		} else if (this.showVerticalLine) {
			helpers.drawVerticalLine(fgContext, newPos.x, fgContext.canvas.clientHeight, whiteLinestrokeStyle);
		}
	}
}
