package app.billetstudio.catalog.exception;

import app.billetstudio.shared.exception.ApiException;

import org.springframework.http.HttpStatus;

public class ModelNotFoundException extends ApiException {

    public ModelNotFoundException() {
        super("MODEL_NOT_FOUND", HttpStatus.NOT_FOUND);
    }
}
