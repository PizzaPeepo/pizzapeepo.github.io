import Lissajous from "./LissajousFigure.js";
import Vector2D from "../Utils/Vector2D.js";

export default class LissajousTable{
    constructor(canvasWidth, canvasHeight, cellSize){
        this._rows = Math.floor(canvasHeight / cellSize);
        this._cols = Math.floor(canvasWidth / cellSize);
        this._cellSize = cellSize;
        this.figures = [];
        this.FillTable();
    }

    get rows(){
        return this._rows;
    }

    set rows(newRowCount){
        this._rows = newRowCount;
    }

    get cols(){
        return this._cols;
    }

    set cols(newColCount){
        this._cols = newColCount;
    }

    ClearTable(){
        this.figures = [];
    }

    // TODO: fix bug where only on rows == cols all figures are drawn correctly
    FillTable(){
        for(let row = 0; row < this.rows ; row++){
            this.figures[row] = [];
            for(let col = 0; col < this.cols; col++){
                const center = new Vector2D( (col+0.5) * this._cellSize, (row+0.5) * this._cellSize);
                // top left entry
                if(row === 0 && col === 0){
                    // this is actually just a dummy that will not be displayed anyways
                    this.figures[row][col] = new Lissajous(center, this._cellSize, 0, 0, 0, Math.PI/2);
                }
                // first row
                else if(row === 0 && col > 0){
                    this.figures[row][col] = new Lissajous(center, this._cellSize, col, col, 0, Math.PI/2, false, true);
                }
                // first column
                else if(col === 0 && row > 0){
                    this.figures[row][col] = new Lissajous(center, this._cellSize, row, row, 0, Math.PI/2, true, false);
                }
                // interior: X follows top-row col frequency, Y follows left-col row frequency
                else{
                    this.figures[row][col] = new Lissajous(center, this._cellSize, col, row, 0, Math.PI/2);
                }
            }
        }
    }

}