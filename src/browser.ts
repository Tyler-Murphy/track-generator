import Bezier from 'bezier-js'
import { makeTrack, Track, getRandomTrackSection, emitter, helpers } from './index'

type Color = 'black' | 'red' | 'blue' | 'green' | 'gray'

console.log('initializing')

let curvesDrawn = 0
const canvas = document.createElement('canvas')
canvas.setAttribute('style', 'border: 1px solid black;')
const canvasWidth = 1000
const canvasHeight = 1000
const canvasAspectRatio = canvasWidth / canvasHeight
canvas.width = canvasWidth
canvas.height = canvasHeight
document.body.appendChild(canvas)

const drawingContext = canvas.getContext('2d') || new Proxy({} as CanvasRenderingContext2D, {
    get() {
        alert('2d drawing context not supported in this browser')
    }
})

function drawTrack(track: Track): void {
    const scaler = getScaler(track)

    track.forEach(({ center, leftEdge, rightEdge }) => {
        drawCurve({ curve: center, scaler, dashed: true, color: 'gray' })
        leftEdge.forEach(curve => drawCurve({ curve, scaler, color: 'red' }))
        rightEdge.forEach(curve => drawCurve({ curve, scaler, color: 'blue' }))
    })
}

function drawCurve({
    curve,
    scaler,
    color = 'black',
    labelStartingPoint = false,
    dashed = false,
}: {
    curve: Bezier,
    scaler: (point: BezierJs.Point) => BezierJs.Point,
    color?: Color
    labelStartingPoint?: boolean,
    dashed?: boolean,
}): void {
    const [
        startingControlPoint,
        ...remainingControlPoints
    ] = curve.points.map(scaler)


    if (remainingControlPoints.length !== 3) {
        throw new Error('only cubic curves are supported')
    }

    drawingContext.setLineDash(dashed ? [5, 15] : [])
    drawingContext.strokeStyle = color
    drawingContext.beginPath()
    drawingContext.moveTo(startingControlPoint.x, startingControlPoint.y)
    drawingContext.bezierCurveTo(
        remainingControlPoints[0].x,
        remainingControlPoints[0].y,
        remainingControlPoints[1].x,
        remainingControlPoints[1].y,
        remainingControlPoints[2].x,
        remainingControlPoints[2].y
    )

    labelStartingPoint && drawingContext.fillText(
        curvesDrawn + ', ' + Math.round(startingControlPoint.x) + ', ' + Math.round(startingControlPoint.y),
        startingControlPoint.x,
        startingControlPoint.y
    )

    drawingContext.stroke()
    drawingContext.closePath()

    curvesDrawn += 1
}

function drawPoint({
    point,
    solid = false,
    color = 'black',
    radius = 15,
    startAngle = 0,
    radians = Math.PI * 2
}: {
    point: BezierJs.Point,
    solid?: boolean,
    color?: Color,
    radius?: number,
    startAngle?: number,
    radians?: number,
}): void {
    const {
        x,
        y,
    } = makeOriginBottomLeft(scalePoint(point))

    drawingContext.strokeStyle = color
    drawingContext.fillStyle = color
    drawingContext.beginPath()
    drawingContext.arc(x, y, radius, startAngle, radians)
    solid ? drawingContext.fill() : drawingContext.stroke()
}

function clearEverything(): void {
    drawingContext.clearRect(0, 0, canvasWidth, canvasHeight)
}


/**
 * Scale points from the range (0, 1) to the range (0, width or height), so that drawing can be done in terms of camvas pixels
 */
function scalePoint(point: BezierJs.Point): BezierJs.Point {
    return {
        x: point.x * canvasWidth,
        y: point.y * canvasHeight
    }
}

/**
 * The canvas origin is at the top left, y increases going dowward, and x increases going to the right.
 * https://stackoverflow.com/questions/54444944/convert-html-canvas-coordinate-system-to-cartesian-system
 */
function makeOriginBottomLeft(point: BezierJs.Point): BezierJs.Point {
    return {
        x: point.x,
        y: canvasHeight - point.y
    }
}

/**
 * Create a function to turn a track's coordinates into pixel coordinates such that the entire track fits on the canvas
 *
 * It figures out how to translate points based on the origin of the bounding box, and then how to scale points based on the size of the bounding box
 */
function getScaler(track: Track): (point: BezierJs.Point) => BezierJs.Point {
    const boundingBox = getBoundingBox(track)
    const origin: BezierJs.Point = {
        x: boundingBox.x.min,
        y: boundingBox.y.min,
    }
    const necessaryTranslation = helpers.points.invert(origin)
    const width = boundingBox.x.max - boundingBox.x.min
    const height = boundingBox.y.max - boundingBox.y.min
    const aspectRatio = width / height
    const widthIsLimitingDimension = aspectRatio > canvasAspectRatio
    const scaleFactor = widthIsLimitingDimension ? canvasWidth / width : canvasHeight / height

    console.debug(`Making scaler`)
    console.debug(`origin`, JSON.stringify(origin))
    console.debug(`width`, width)
    console.debug(`height`, height)
    console.debug(`aspect ratio`, aspectRatio)

    console.debug(`Scale function created for rendering. It will translate points by ${JSON.stringify(necessaryTranslation)}, then scale by ${scaleFactor}. Width is ${widthIsLimitingDimension ? '' : 'not'} the limiting factor.`)

    return point => helpers.points.multiply(
        helpers.points.add(
            point,
            necessaryTranslation,
        ),
        scaleFactor,
    )
}

/** Returns the maximum of the height or width of a track */
function getMaximumDimension(track: Track): number {
    const boundingBox = getBoundingBox(track)
    const height = boundingBox.x.max - boundingBox.x.min
    const width = boundingBox.y.max - boundingBox.y.min

    return Math.max(height, width)
}

function getBoundingBox(track: Track): BezierJs.BBox {
    const allCurves = track.flatMap(trackSection => [
        trackSection.center,
        ...trackSection.leftEdge,
        ...trackSection.rightEdge,
    ])

    return Bezier.getUtils().findbbox(allCurves)
}

async function refresh(): Promise<void> {
    emitter.removeAllListeners('sectionsSoFar')
    emitter.on('sectionsSoFar', track => {
        clearEverything()
        drawTrack(track)
    })

    const track = await makeTrack(200)

    clearEverything()

    drawTrack(track)
}

(window as any).drawTrack = drawTrack

addEventListener('click', async () => {
    console.log(`refreshing because of click`)
    await refresh()
})
