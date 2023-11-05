// var browserify = require('browserify');
// var gulp = require('gulp');
// var source = require('vinyl-source-stream');
import browserify from "browserify";
import gulp from "gulp";
import source from "vinyl-source-stream";


gulp.task('build', function () {

    return browserify(['index.js'])
        .transform("babelify",
        {
            presets: ['@babel/preset-env'],
            targets: {
                "chrome": "58"
            }
        })
        .bundle()
        .pipe(source('bgscript.js'))
        .pipe(gulp.dest('build/'));
});
