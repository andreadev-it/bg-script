var browserify = require('browserify');
var gulp = require('gulp');
var source = require('vinyl-source-stream');

gulp.task('browserify', function () {

    return browserify(['/src/CustomEventTarget.js', '/src/Connection.js', '/src/BackgroundHandler.js', '/src/BackgroundScript.js'])
        .bundle()
        .pipe(source('bgscript.js'))
        .pipe(gulp.dest('/build/'));
});