package solver

import (
	twenty48 "ebiten/examples/2048/2048"
	"slices"
)

var actions []twenty48.Dir = []twenty48.Dir{
	twenty48.DirUp, twenty48.DirDown, twenty48.DirLeft, twenty48.DirRight,
}

func NextAction(size int, board []int) (twenty48.Dir, bool) {
	var current *twenty48.Dir
	var score float64

	for _, action := range actions {
		newScore := 0.0
		board := slices.Clone(board)

		applyAction(size, board, action)
		computeScore(size, board)

		if current == nil || newScore > score {
			current = &action
			score = newScore
		}
	}

	return *current, current != nil
}

func applyAction(size int, board []int, action twenty48.Dir) {
	twenty48.MoveTiles()
}

func computeScore(size int, board []int) {
}

func heuristic() float64 {
	return 0.0
}
